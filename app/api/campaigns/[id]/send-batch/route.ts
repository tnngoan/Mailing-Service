import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { prisma } from '@/lib/prisma';
import { getProviders, getProviderCapacities } from '@/lib/providers';
import { processBatch } from '@/lib/worker';

// POST /api/campaigns/:id/send-batch — trigger today's daily batch
// Respects pre-assigned providers — each recipient already has a fixed provider
// from upload time. Only sends up to each provider's remaining daily capacity.
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
      // Check if it's been stuck for more than 5 minutes — auto-recover
      const updatedAt = new Date(campaign.updatedAt).getTime();
      const stuckMinutes = (Date.now() - updatedAt) / 60000;
      if (stuckMinutes > 5) {
        console.warn(`[send-batch] Campaign ${id} stuck in "sending" for ${stuckMinutes.toFixed(0)}m — resetting to paused`);
        await prisma.campaign.update({
          where: { id },
          data: { status: 'paused' },
        });
        // Reset any recipients still pending with a batchDay (stale assignment)
        await prisma.recipient.updateMany({
          where: { campaignId: id, status: 'pending', batchDay: { not: null } },
          data: { batchDay: null },
        });
      } else {
        return NextResponse.json(
          { error: 'A batch is already being sent for this campaign' },
          { status: 409 }
        );
      }
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
    const capacityMap = new Map(capacities.map((c) => [c.provider.name, c]));
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

    // Count pending recipients per provider (using pre-assigned providers)
    const pendingByProvider = await prisma.recipient.groupBy({
      by: ['provider'],
      where: { campaignId: id, status: 'pending' },
      _count: true,
    });

    if (pendingByProvider.length === 0) {
      await prisma.campaign.update({
        where: { id },
        data: { status: 'completed' },
      });
      return NextResponse.json({ error: 'No pending recipients left' }, { status: 400 });
    }

    // Determine batch day
    const lastBatch = await prisma.recipient.aggregate({
      where: { campaignId: id, batchDay: { not: null } },
      _max: { batchDay: true },
    });
    const batchDay = (lastBatch._max.batchDay ?? 0) + 1;

    // For each provider, take up to its remaining capacity from its own pool
    let totalBatchSize = 0;
    const providerBreakdown: { provider: string; count: number }[] = [];

    for (const group of pendingByProvider) {
      const providerName = group.provider;
      if (!providerName) continue;

      const capacity = capacityMap.get(providerName);
      if (!capacity || capacity.remaining === 0) {
        console.log(`[send-batch] ${providerName}: at daily limit, skipping its recipients`);
        continue;
      }

      const takeCount = Math.min(group._count, capacity.remaining);

      // Assign batchDay to this provider's pending recipients (up to capacity)
      const recipientIds = await prisma.recipient.findMany({
        where: { campaignId: id, status: 'pending', provider: providerName },
        orderBy: { id: 'asc' },
        take: takeCount,
        select: { id: true },
      });

      if (recipientIds.length > 0) {
        await prisma.recipient.updateMany({
          where: { id: { in: recipientIds.map((r) => r.id) } },
          data: { batchDay },
        });

        totalBatchSize += recipientIds.length;
        providerBreakdown.push({ provider: providerName, count: recipientIds.length });
      }
    }

    if (totalBatchSize === 0) {
      return NextResponse.json(
        { error: 'No capacity available for any provider with pending recipients. Try again tomorrow.' },
        { status: 429 }
      );
    }

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

    const totalPending = pendingByProvider.reduce((s, g) => s + g._count, 0);
    const remainingAfter = totalPending - totalBatchSize;

    return NextResponse.json({
      batchDay,
      batchSize: totalBatchSize,
      remainingAfter,
      dailyCapacityUsed: capacities.map((c) => ({
        provider: c.provider.name,
        usedToday: c.usedToday,
        dailyLimit: c.dailyLimit,
        remaining: c.remaining,
      })),
      providerBreakdown,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns/[id]/send-batch]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
