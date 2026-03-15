import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { prisma } from '@/lib/prisma';
import { getProviders, getProviderCapacities, allocateEmailsWithCapacity } from '@/lib/providers';
import { processBatch } from '@/lib/worker';

// POST /api/campaigns/:id/send-batch — trigger today's daily batch
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (campaign.status === 'sending') {
      return NextResponse.json(
        { error: 'A batch is already being sent for this campaign' },
        { status: 409 }
      );
    }

    if (campaign.status === 'completed') {
      return NextResponse.json(
        { error: 'Campaign is already completed' },
        { status: 400 }
      );
    }

    const providers = getProviders();
    if (providers.length === 0) {
      return NextResponse.json(
        { error: 'No email providers configured' },
        { status: 500 }
      );
    }

    // Check today's remaining capacity per provider
    const capacities = await getProviderCapacities();
    const totalRemaining = capacities.reduce((s, c) => s + c.remaining, 0);

    if (totalRemaining === 0) {
      const usageSummary = capacities
        .map((c) => `${c.provider.name}: ${c.usedToday}/${c.dailyLimit}`)
        .join(', ');
      return NextResponse.json(
        { error: `All providers have reached their daily limit. Try again tomorrow. (${usageSummary})` },
        { status: 429 }
      );
    }

    // Count pending recipients
    const pendingCount = await prisma.recipient.count({
      where: { campaignId: id, status: 'pending' },
    });

    if (pendingCount === 0) {
      await prisma.campaign.update({
        where: { id },
        data: { status: 'completed' },
      });
      return NextResponse.json({ error: 'No pending recipients left' }, { status: 400 });
    }

    const batchSize = Math.min(pendingCount, totalRemaining);

    const lastBatch = await prisma.recipient.aggregate({
      where: { campaignId: id, batchDay: { not: null } },
      _max: { batchDay: true },
    });
    const batchDay = (lastBatch._max.batchDay ?? 0) + 1;

    // Select pending recipients for this batch
    const pendingRecipients = await prisma.recipient.findMany({
      where: { campaignId: id, status: 'pending' },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, email: true },
    });

    // Allocate emails using remaining capacity (not full daily limits)
    const emailList = pendingRecipients.map((r) => r.email);
    const allocations = allocateEmailsWithCapacity(emailList, capacities);

    if (allocations.length === 0) {
      return NextResponse.json(
        { error: 'No provider capacity available for allocation' },
        { status: 429 }
      );
    }

    // Assign provider and batchDay to each recipient
    let offset = 0;
    for (const alloc of allocations) {
      const recipientIds = pendingRecipients
        .slice(offset, offset + alloc.emails.length)
        .map((r) => r.id);

      await prisma.recipient.updateMany({
        where: { id: { in: recipientIds } },
        data: { provider: alloc.provider.name, batchDay },
      });

      offset += alloc.emails.length;
    }

    const actualBatchSize = allocations.reduce((s, a) => s + a.emails.length, 0);

    // Update campaign status to sending
    await prisma.campaign.update({
      where: { id },
      data: { status: 'sending' },
    });

    // Start the worker in background
    waitUntil(
      processBatch(id, batchDay).catch((err) => {
        console.error('[send-batch worker error]', err);
      })
    );

    const remainingAfter = pendingCount - actualBatchSize;

    return NextResponse.json({
      batchDay,
      batchSize: actualBatchSize,
      remainingAfter,
      dailyCapacityUsed: capacities.map((c) => ({
        provider: c.provider.name,
        usedToday: c.usedToday,
        dailyLimit: c.dailyLimit,
        remaining: c.remaining,
      })),
      providerBreakdown: allocations.map((a) => ({
        provider: a.provider.name,
        count: a.emails.length,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns/[id]/send-batch]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
