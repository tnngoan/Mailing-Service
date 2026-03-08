import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { prisma, ensureSchema } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';
import { storeEmails } from '@/lib/email-store';
import { processCampaign } from '@/lib/worker';

// GET /api/campaigns — list recent campaigns
export async function GET() {
  try {
    await ensureSchema();
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json(campaigns);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/campaigns — accepts multipart/form-data: subject + content + CSV file
// Emails are parsed from the uploaded CSV and held in memory only — never stored in the DB.
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();

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

    const campaign = await prisma.campaign.create({
      data: {
        subject,
        content,
        status: 'queued',
        totalRecipients: emails.length,
      },
    });

    // Store emails in memory — not in the database
    storeEmails(campaign.id, emails);

    // waitUntil keeps the Vercel serverless function alive until the
    // campaign finishes sending, instead of killing it after the response.
    waitUntil(
      processCampaign(campaign.id).catch((err) => {
        console.error('[campaign worker error]', err);
      })
    );

    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
