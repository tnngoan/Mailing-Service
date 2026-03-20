import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { getTotalDailyLimit, getProviders, assignProviderSegments } from '@/lib/providers';
import { bulkUpsertContacts, bulkInsertRecipients } from '@/lib/bulk-sql';

export const maxDuration = 60;

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

    // Bulk-upsert CSV emails into Contact table (fast INSERT OR IGNORE)
    await bulkUpsertContacts(csvEmails);

    // Get rest of contacts (not in CSV) for auto-include as lowest tier
    const allContacts = await prisma.contact.findMany({ select: { email: true } });
    const csvSet = new Set(csvEmails);
    const restEmails = allContacts.map((c) => c.email).filter((e) => !csvSet.has(e));

    const totalCount = csvEmails.length + restEmails.length;
    const allEmails = [...csvEmails, ...restEmails];
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

    // Build recipient rows: CSV = priority 1, rest = priority 2 (autoIncluded)
    const recipients = allEmails.map((email, idx) => {
      const isCsv = idx < csvEmails.length;
      const segment = segments.find((s) => idx >= s.startIndex && idx < s.endIndex);
      return {
        email,
        provider: segment?.provider.name ?? providers[0].name,
        priority: isCsv ? 1 : 2,
        autoIncluded: !isCsv,
      };
    });

    await bulkInsertRecipients(campaign.id, recipients);

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
