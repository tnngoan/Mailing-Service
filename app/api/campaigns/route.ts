import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { getTotalDailyLimit, getProviders } from '@/lib/providers';

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
    const emails = parseEmailsFromCSV(csvText);

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'No valid email addresses found in the uploaded CSV' },
        { status: 400 }
      );
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        subject,
        content,
        status: 'pending',
        totalRecipients: emails.length,
      },
    });

    // Bulk-insert recipients in chunks of 1000
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
      const chunk = emails.slice(i, i + CHUNK_SIZE);
      await prisma.recipient.createMany({
        data: chunk.map((email) => ({
          campaignId: campaign.id,
          email,
          status: 'pending',
        })),
      });
    }

    const dailyLimit = getTotalDailyLimit();
    const daysNeeded = Math.ceil(emails.length / dailyLimit);

    return NextResponse.json(
      {
        ...campaign,
        dailyLimit,
        daysNeeded,
        providerCount: providers.length,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
