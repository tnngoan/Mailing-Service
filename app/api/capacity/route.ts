import { NextResponse } from 'next/server';
import { measureCapacity } from '@/lib/capacity-checker';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/capacity — real-time provider capacity measurement
export async function GET() {
  try {
    const reports = await measureCapacity();

    const totalRemaining = reports.reduce((s, r) => s + r.remaining, 0);
    const totalLimit = reports.reduce((s, r) => s + r.configuredLimit, 0);
    const totalSent = reports.reduce((s, r) => s + r.sentToday, 0);
    const availableCount = reports.filter((r) => r.status === 'available').length;
    const exhaustedCount = reports.filter((r) => r.status === 'exhausted').length;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      summary: {
        totalProviders: reports.length,
        availableProviders: availableCount,
        exhaustedProviders: exhaustedCount,
        totalDailyLimit: totalLimit,
        totalSentToday: totalSent,
        totalRemaining,
        capacityPercent: totalLimit > 0 ? Math.round((totalRemaining / totalLimit) * 100) : 0,
      },
      providers: reports,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/capacity]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
