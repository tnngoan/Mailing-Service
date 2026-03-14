import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTotalDailyLimit } from '@/lib/providers';

// GET /api/campaigns/:id — poll campaign status with recipient stats
export async function GET(
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

    // Get status breakdown
    const statusCounts = await prisma.recipient.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: true,
    });

    const pendingCount = statusCounts.find((c) => c.status === 'pending')?._count ?? 0;
    const sentCount = statusCounts.find((c) => c.status === 'sent')?._count ?? 0;
    const failedCount = statusCounts.find((c) => c.status === 'failed')?._count ?? 0;

    // Get daily batch history
    const batchHistory = await prisma.recipient.groupBy({
      by: ['batchDay', 'status'],
      where: { campaignId: id, batchDay: { not: null } },
      _count: true,
    });

    // Aggregate batch history by day
    const days = new Map<number, { sent: number; failed: number }>();
    for (const row of batchHistory) {
      if (row.batchDay === null) continue;
      const day = days.get(row.batchDay) ?? { sent: 0, failed: 0 };
      if (row.status === 'sent') day.sent = row._count;
      if (row.status === 'failed') day.failed = row._count;
      days.set(row.batchDay, day);
    }

    const dailyLimit = getTotalDailyLimit();
    const daysRemaining = dailyLimit > 0 ? Math.ceil(pendingCount / dailyLimit) : 0;

    return NextResponse.json({
      ...campaign,
      sentCount,
      failedCount,
      pendingCount,
      dailyLimit,
      daysRemaining,
      batchHistory: Array.from(days.entries())
        .sort(([a], [b]) => a - b)
        .map(([day, counts]) => ({ day, ...counts })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
