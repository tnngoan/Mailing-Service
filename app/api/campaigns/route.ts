import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { getTotalDailyLimit, getProviders, assignProviderSegments } from '@/lib/providers';

// GET /api/campaigns — list recent campaigns with recipient stats
export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(campaigns);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/campaigns — upload CSV + create campaign with recipients stored in DB.
// Assigns each recipient a fixed provider at upload time (deterministic segments).
// Does NOT start sending — user triggers daily batches via POST /api/campaigns/[id]/send-batch.
export async function POST(req: NextRequest) {
  try {
    const providers = getProviders();
    if (providers.length === 0) {
      return NextResponse.json(
        { error: 'No email providers configured. Set at least one API key.' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const subject = (formData.get('subject') as string | null)?.trim();
    const content = (formData.get('content') as string | null)?.trim();
    const file = formData.get('file') as File | null;

    if (!subject || !content) {
      return NextResponse.json(
        { error: 'Subject and content are required' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: 'A CSV file with recipient email addresses is required' },
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

    // Upsert CSV emails into the master Contact table
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

    // Get rest of contacts (not in CSV) for auto-include as lowest tier
    const allContacts = await prisma.contact.findMany({ select: { email: true } });
    const csvSet = new Set(csvEmails);
    const restEmails = allContacts.map((c) => c.email).filter((e) => !csvSet.has(e));

    // Combined: CSV first (priority 1), rest of contacts (priority 2, auto-included)
    const allEmails = [...csvEmails, ...restEmails];
    const totalCount = allEmails.length;

    const segments = assignProviderSegments(totalCount, providers);

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        subject,
        content,
        status: 'pending',
        totalRecipients: totalCount,
      },
    });

    // Bulk-insert: CSV = priority 1, rest = priority 2 (autoIncluded)
    for (let i = 0; i < allEmails.length; i += CHUNK_SIZE) {
      const chunk = allEmails.slice(i, i + CHUNK_SIZE);
      await prisma.recipient.createMany({
        data: chunk.map((email, chunkIdx) => {
          const globalIdx = i + chunkIdx;
          const isCsv = globalIdx < csvEmails.length;
          const segment = segments.find(
            (s) => globalIdx >= s.startIndex && globalIdx < s.endIndex
          );
          return {
            campaignId: campaign.id,
            email,
            status: 'pending',
            provider: segment?.provider.name ?? providers[0].name,
            priority: isCsv ? 1 : 2,
            autoIncluded: !isCsv,
          };
        }),
      });
    }

    const dailyLimit = getTotalDailyLimit();
    const daysNeeded = Math.ceil(totalCount / dailyLimit);

    return NextResponse.json(
      {
        ...campaign,
        dailyLimit,
        daysNeeded,
        providerCount: providers.length,
        csvRecipients: csvEmails.length,
        contactsRecipients: restEmails.length,
        priorityLayers: 2,
        providerSegments: segments.map((s) => ({
          provider: s.provider.name,
          count: s.count,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
