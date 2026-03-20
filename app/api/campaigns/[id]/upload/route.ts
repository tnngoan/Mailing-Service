import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { getProviders, assignProviderSegments } from '@/lib/providers';

// POST /api/campaigns/:id/upload — add a new CSV as the next priority layer.
//
// Flow:
// 1. Delete all PENDING auto-included recipients (they'll be re-created at the new bottom)
// 2. Upsert CSV emails into Contact table
// 3. Add new CSV emails (not already in campaign from earlier CSV uploads) at next priority
// 4. Promote CSV emails that were in the auto-included tier to the new CSV priority
// 5. Re-create auto-included tier for remaining contacts at the new bottom
//
// Example: campaign has priority 1 (CSV1), priority 2 (rest, autoIncluded)
//   → upload CSV2 → priority 1 (CSV1), priority 2 (CSV2), priority 3 (rest, autoIncluded)
export async function POST(
  req: NextRequest,
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
        { error: 'Cannot upload while a batch is sending. Wait for it to finish.' },
        { status: 409 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        { error: 'A CSV file is required' },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const csvEmails = parseEmailsFromCSV(csvText);

    if (csvEmails.length === 0) {
      return NextResponse.json(
        { error: 'No valid email addresses found in the uploaded CSV' },
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

    // Step 1: Upsert CSV emails into master Contact table
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < csvEmails.length; i += CHUNK_SIZE) {
      const chunk = csvEmails.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((email) =>
          prisma.contact.upsert({
            where: { email },
            create: { email, source: 'csv-upload' },
            update: {},
          })
        )
      );
    }

    // Step 2: Delete all PENDING auto-included recipients (will be re-created at new bottom)
    // Sent/failed auto-included recipients stay — they've already been delivered
    const deletedAutoIncluded = await prisma.recipient.deleteMany({
      where: { campaignId: id, autoIncluded: true, status: 'pending' },
    });

    // Step 3: Find the highest CSV priority (non-autoIncluded) in this campaign
    const maxCsvPriority = await prisma.recipient.aggregate({
      where: { campaignId: id, autoIncluded: false },
      _max: { priority: true },
    });
    const nextCsvPriority = (maxCsvPriority._max.priority ?? 0) + 1;

    // Step 4: Find emails already in this campaign from prior CSV uploads — skip them
    const existingCsvRecipients = await prisma.recipient.findMany({
      where: { campaignId: id, autoIncluded: false },
      select: { email: true },
    });
    const existingCsvSet = new Set(existingCsvRecipients.map((r) => r.email));
    const newCsvEmails = csvEmails.filter((e) => !existingCsvSet.has(e));

    // Step 5: Insert new CSV emails at the new priority layer
    let csvAdded = 0;
    if (newCsvEmails.length > 0) {
      const csvSegments = assignProviderSegments(newCsvEmails.length, providers);
      for (let i = 0; i < newCsvEmails.length; i += CHUNK_SIZE) {
        const chunk = newCsvEmails.slice(i, i + CHUNK_SIZE);
        await prisma.recipient.createMany({
          data: chunk.map((email, chunkIdx) => {
            const globalIdx = i + chunkIdx;
            const segment = csvSegments.find(
              (s) => globalIdx >= s.startIndex && globalIdx < s.endIndex
            );
            return {
              campaignId: id,
              email,
              status: 'pending',
              provider: segment?.provider.name ?? providers[0].name,
              priority: nextCsvPriority,
              autoIncluded: false,
            };
          }),
        });
      }
      csvAdded = newCsvEmails.length;
    }

    // Step 6: Re-create auto-included tier — all contacts NOT already in this campaign
    const allCampaignEmails = await prisma.recipient.findMany({
      where: { campaignId: id },
      select: { email: true },
    });
    const campaignEmailSet = new Set(allCampaignEmails.map((r) => r.email));

    const allContacts = await prisma.contact.findMany({ select: { email: true } });
    const restEmails = allContacts.map((c) => c.email).filter((e) => !campaignEmailSet.has(e));

    const restPriority = nextCsvPriority + 1;

    if (restEmails.length > 0) {
      const restSegments = assignProviderSegments(restEmails.length, providers);
      for (let i = 0; i < restEmails.length; i += CHUNK_SIZE) {
        const chunk = restEmails.slice(i, i + CHUNK_SIZE);
        await prisma.recipient.createMany({
          data: chunk.map((email, chunkIdx) => {
            const globalIdx = i + chunkIdx;
            const segment = restSegments.find(
              (s) => globalIdx >= s.startIndex && globalIdx < s.endIndex
            );
            return {
              campaignId: id,
              email,
              status: 'pending',
              provider: segment?.provider.name ?? providers[0].name,
              priority: restPriority,
              autoIncluded: true,
            };
          }),
        });
      }
    }

    // Step 7: Update campaign totalRecipients + reopen if completed
    const totalRecipients = await prisma.recipient.count({ where: { campaignId: id } });
    await prisma.campaign.update({
      where: { id },
      data: {
        totalRecipients,
        // Reopen completed campaigns since we've added new pending recipients
        ...(campaign.status === 'completed' ? { status: 'paused' } : {}),
      },
    });

    const skipped = csvEmails.length - csvAdded;

    return NextResponse.json({
      csvAdded,
      skipped,
      autoIncludedRemoved: deletedAutoIncluded.count,
      autoIncludedRecreated: restEmails.length,
      priorityLayer: nextCsvPriority,
      totalPriorityLayers: restEmails.length > 0 ? restPriority : nextCsvPriority,
      totalRecipients,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns/[id]/upload]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
