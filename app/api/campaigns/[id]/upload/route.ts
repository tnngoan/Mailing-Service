import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { getProviders, assignProviderSegments } from '@/lib/providers';
import { bulkUpsertContacts, bulkInsertRecipients } from '@/lib/bulk-sql';

export const maxDuration = 60;

// POST /api/campaigns/:id/upload — add a new CSV as the next priority layer.
// Each upload slots in before the auto-included "rest of contacts" tier.
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
      return NextResponse.json({ error: 'A CSV file is required' }, { status: 400 });
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
      return NextResponse.json({ error: 'No email providers configured' }, { status: 500 });
    }

    // Step 1: Bulk-upsert CSV emails into Contact table (fast INSERT OR IGNORE)
    await bulkUpsertContacts(csvEmails);

    // Step 2: Delete PENDING auto-included recipients (will be re-created at new bottom)
    const deletedAutoIncluded = await prisma.recipient.deleteMany({
      where: { campaignId: id, autoIncluded: true, status: 'pending' },
    });

    // Step 3: Determine next CSV priority
    const maxCsvPriority = await prisma.recipient.aggregate({
      where: { campaignId: id, autoIncluded: false },
      _max: { priority: true },
    });
    const nextCsvPriority = (maxCsvPriority._max.priority ?? 0) + 1;

    // Step 4: Skip emails already in campaign from prior CSV uploads
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
      const csvRecipients = newCsvEmails.map((email, idx) => {
        const segment = csvSegments.find((s) => idx >= s.startIndex && idx < s.endIndex);
        return {
          email,
          provider: segment?.provider.name ?? providers[0].name,
          priority: nextCsvPriority,
          autoIncluded: false,
        };
      });
      await bulkInsertRecipients(id, csvRecipients);
      csvAdded = newCsvEmails.length;
    }

    // Step 6: Re-create auto-included tier for remaining contacts
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
      const restRecipients = restEmails.map((email, idx) => {
        const segment = restSegments.find((s) => idx >= s.startIndex && idx < s.endIndex);
        return {
          email,
          provider: segment?.provider.name ?? providers[0].name,
          priority: restPriority,
          autoIncluded: true,
        };
      });
      await bulkInsertRecipients(id, restRecipients);
    }

    // Step 7: Update campaign totalRecipients + reopen if completed
    const totalRecipients = await prisma.recipient.count({ where: { campaignId: id } });
    await prisma.campaign.update({
      where: { id },
      data: {
        totalRecipients,
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
