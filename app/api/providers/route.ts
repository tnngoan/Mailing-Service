import { NextResponse } from 'next/server';
import { getProviders, getTotalDailyLimit } from '@/lib/providers';

// GET /api/providers — list active email providers and their limits
export async function GET() {
  const providers = getProviders();
  return NextResponse.json({
    providers: providers.map((p) => ({
      name: p.name,
      dailyLimit: p.dailyLimit,
      batchSize: p.batchSize,
    })),
    totalDailyLimit: getTotalDailyLimit(),
  });
}
