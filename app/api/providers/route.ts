import { NextResponse } from 'next/server';
import { getProviders, getTotalDailyLimit, getProviderCapacities } from '@/lib/providers';

// GET /api/providers — list active email providers with today's usage
export async function GET() {
  const providers = getProviders();
  const capacities = await getProviderCapacities();

  const totalRemaining = capacities.reduce((s, c) => s + c.remaining, 0);

  return NextResponse.json({
    providers: capacities.map((c) => ({
      name: c.provider.name,
      dailyLimit: c.dailyLimit,
      usedToday: c.usedToday,
      remaining: c.remaining,
      tier: c.provider.tier,
    })),
    totalDailyLimit: getTotalDailyLimit(),
    totalRemaining,
  });
}
