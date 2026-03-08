import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processCampaign } from '@/lib/worker';

// GET /api/campaigns — list all campaigns (newest first)
export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json(campaigns);
}

// POST /api/campaigns — create and kick off a campaign
export async function POST(req: NextRequest) {
  try {
    const { subject, content } = await req.json();

    if (!subject?.trim() || !content?.trim()) {
      return NextResponse.json(
        { error: 'Subject and content are required' },
        { status: 400 }
      );
    }

    const emailCount = await prisma.email.count();
    if (emailCount === 0) {
      return NextResponse.json(
        { error: 'No email addresses in the database. Upload a CSV first.' },
        { status: 400 }
      );
    }

    const campaign = await prisma.campaign.create({
      data: {
        subject: subject.trim(),
        content: content.trim(),
        status: 'queued',
        totalRecipients: emailCount,
      },
    });

    // Fire-and-forget background processing
    // NOTE: on serverless platforms this will be killed when the response returns.
    // For Vercel: use a separate worker service or Vercel Cron.
    // For Railway/Render: this works fine as a long-running process.
    processCampaign(campaign.id).catch((err) => {
      console.error('[campaign worker error]', err);
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    console.error('[POST /api/campaigns]', err);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
