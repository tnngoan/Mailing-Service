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

    // Per-provider breakdown with failure reasons
    const providerStats = await prisma.recipient.groupBy({
      by: ['provider', 'status'],
      where: { campaignId: id, provider: { not: null } },
      _count: true,
    });

    const providerMap = new Map<string, { sent: number; failed: number }>();
    for (const row of providerStats) {
      if (!row.provider) continue;
      const entry = providerMap.get(row.provider) ?? { sent: 0, failed: 0 };
      if (row.status === 'sent') entry.sent = row._count;
      if (row.status === 'failed') entry.failed = row._count;
      providerMap.set(row.provider, entry);
    }

    // Get distinct error messages per failed provider
    const failedProviderErrors = failedCount > 0
      ? await prisma.recipient.groupBy({
          by: ['provider', 'error'],
          where: { campaignId: id, status: 'failed', provider: { not: null } },
          _count: true,
        })
      : [];

    const errorsByProvider = new Map<string, string[]>();
    for (const row of failedProviderErrors) {
      if (!row.provider || !row.error) continue;
      const list = errorsByProvider.get(row.provider) ?? [];
      list.push(`${row.error} (${row._count})`);
      errorsByProvider.set(row.provider, list);
    }

    const providerReport = Array.from(providerMap.entries())
      .map(([provider, counts]) => ({
        provider,
        ...counts,
        errors: errorsByProvider.get(provider) ?? [],
      }))
      .sort((a, b) => b.sent - a.sent || a.failed - b.failed);

    // Provider assignment overview (total assigned per provider including pending)
    const providerAssignments = await prisma.recipient.groupBy({
      by: ['provider', 'status'],
      where: { campaignId: id },
      _count: true,
    });

    const assignmentMap = new Map<string, { total: number; pending: number; sent: number; failed: number }>();
    for (const row of providerAssignments) {
      const key = row.provider ?? 'unassigned';
      const entry = assignmentMap.get(key) ?? { total: 0, pending: 0, sent: 0, failed: 0 };
      entry.total += row._count;
      if (row.status === 'pending') entry.pending = row._count;
      if (row.status === 'sent') entry.sent = row._count;
      if (row.status === 'failed') entry.failed = row._count;
      assignmentMap.set(key, entry);
    }

    const providerAssignmentList = Array.from(assignmentMap.entries())
      .map(([provider, counts]) => ({ provider, ...counts }))
      .sort((a, b) => b.total - a.total);

    // Daily breakdown by provider (batch day × provider)
    const dailyByProvider = await prisma.recipient.groupBy({
      by: ['batchDay', 'provider', 'status'],
      where: { campaignId: id, batchDay: { not: null }, provider: { not: null } },
      _count: true,
    });

    const dailyProviderMap = new Map<number, Map<string, { sent: number; failed: number }>>();
    for (const row of dailyByProvider) {
      if (row.batchDay === null || !row.provider) continue;
      const dayMap = dailyProviderMap.get(row.batchDay) ?? new Map();
      const entry = dayMap.get(row.provider) ?? { sent: 0, failed: 0 };
      if (row.status === 'sent') entry.sent = row._count;
      if (row.status === 'failed') entry.failed = row._count;
      dayMap.set(row.provider, entry);
      dailyProviderMap.set(row.batchDay, dayMap);
    }

    const dailyProviderReport = Array.from(dailyProviderMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, providers]) => ({
        day,
        providers: Array.from(providers.entries())
          .map(([provider, counts]) => ({ provider, ...counts }))
          .sort((a, b) => b.sent - a.sent),
      }));

    // Priority breakdown with dynamic labels
    const priorityCounts = await prisma.recipient.groupBy({
      by: ['priority', 'status', 'autoIncluded'],
      where: { campaignId: id },
      _count: true,
    });

    const priorityMap = new Map<number, { total: number; pending: number; sent: number; failed: number; autoIncluded: boolean }>();
    for (const row of priorityCounts) {
      const p = row.priority ?? 2;
      const entry = priorityMap.get(p) ?? { total: 0, pending: 0, sent: 0, failed: 0, autoIncluded: false };
      entry.total += row._count;
      if (row.status === 'pending') entry.pending += row._count;
      if (row.status === 'sent') entry.sent += row._count;
      if (row.status === 'failed') entry.failed += row._count;
      if (row.autoIncluded) entry.autoIncluded = true;
      priorityMap.set(p, entry);
    }

    // Label: CSV layers get "CSV upload #N", auto-included gets "Contacts DB"
    let csvLayerNum = 0;
    const priorityBreakdown = Array.from(priorityMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([priority, counts]) => {
        const { autoIncluded, ...rest } = counts;
        let label: string;
        if (autoIncluded) {
          label = 'Contacts DB (auto)';
        } else {
          csvLayerNum++;
          label = `CSV upload #${csvLayerNum}`;
        }
        return { priority, label, ...rest };
      });

    const dailyLimit = getTotalDailyLimit();
    const daysRemaining = dailyLimit > 0 ? Math.ceil(pendingCount / dailyLimit) : 0;

    return NextResponse.json({
      ...campaign,
      sentCount,
      failedCount,
      pendingCount,
      dailyLimit,
      daysRemaining,
      priorityBreakdown,
      batchHistory: Array.from(days.entries())
        .sort(([a], [b]) => a - b)
        .map(([day, counts]) => ({ day, ...counts })),
      providerReport,
      providerAssignments: providerAssignmentList,
      dailyProviderReport,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
