/**
 * Real-time capacity checker — queries each provider's API and our DB
 * to get accurate remaining capacity. Combines:
 * 1. Provider API stats (actual usage at the provider level)
 * 2. Our DB stats (emails sent today via our system)
 * 3. Configured daily limits (fallback if API unavailable)
 *
 * Returns an ordered list from most capacity to least.
 */

import { prisma } from './prisma';
import { getProviders } from './providers';

export interface ProviderCapacityReport {
  provider: string;
  tier: string;
  configuredLimit: number;
  sentToday: number;         // from our DB
  providerReported: number | null;  // from provider API (null = unavailable)
  remaining: number;
  source: 'api' | 'db' | 'config';  // where the remaining count comes from
  status: 'available' | 'exhausted' | 'error' | 'inactive';
  error?: string;
}

async function checkSendGrid(): Promise<{ used: number | null; error?: string }> {
  const apiKey = (process.env.SENDGRID_API_KEY ?? '').trim();
  if (!apiKey) return { used: null, error: 'No API key' };

  try {
    // Get today's stats
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `https://api.sendgrid.com/v3/stats?start_date=${today}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) return { used: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const stats = data[0]?.stats?.[0]?.metrics;
      const used = stats?.requests ?? stats?.delivered ?? null;
      return { used: typeof used === 'number' ? used : null };
    }
    return { used: 0 };
  } catch (err) {
    return { used: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function checkMailjet(): Promise<{ used: number | null; error?: string }> {
  const apiKey = (process.env.MAILJET_API_KEY ?? '').trim();
  const secretKey = (process.env.MAILJET_SECRET_KEY ?? '').trim();
  if (!apiKey || !secretKey) return { used: null, error: 'No API key' };

  try {
    const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const res = await fetch('https://api.mailjet.com/v3/REST/statcounters?CounterSource=APIKey&CounterTiming=Day&CounterResolution=Day&Limit=1', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return { used: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    const count = data?.Data?.[0]?.MessageSentCount;
    return { used: typeof count === 'number' ? count : null };
  } catch (err) {
    return { used: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function checkMailtrap(): Promise<{ used: number | null; error?: string }> {
  const apiKey = (process.env.MAILTRAP_API_KEY ?? '').trim();
  if (!apiKey) return { used: null, error: 'No API key' };

  try {
    // Get accounts first
    const acctRes = await fetch('https://mailtrap.io/api/accounts', {
      headers: { 'Api-Token': apiKey },
    });
    if (!acctRes.ok) return { used: null, error: `HTTP ${acctRes.status}` };
    const accounts = await acctRes.json();
    const accountId = accounts?.[0]?.id;
    if (!accountId) return { used: null, error: 'No account found' };

    // Get usage
    const statsRes = await fetch(`https://mailtrap.io/api/accounts/${accountId}/account_usages`, {
      headers: { 'Api-Token': apiKey },
    });
    if (!statsRes.ok) return { used: null, error: `Stats HTTP ${statsRes.status}` };
    const stats = await statsRes.json();
    const sent = stats?.send_daily_usage ?? stats?.daily_emails_sent;
    return { used: typeof sent === 'number' ? sent : null };
  } catch (err) {
    return { used: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function checkResend(): Promise<{ used: number | null; error?: string }> {
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return { used: null, error: 'No API key' };

  try {
    const res = await fetch('https://api.resend.com/emails?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // Resend doesn't have a direct usage endpoint, fallback to DB
    return { used: null };
  } catch {
    return { used: null };
  }
}

async function checkMailgun(): Promise<{ used: number | null; error?: string }> {
  const apiKey = (process.env.MAILGUN_API_KEY ?? '').trim();
  const domain = (process.env.MAILGUN_DOMAIN ?? '').trim();
  if (!apiKey || !domain) return { used: null, error: 'No API key or domain' };

  try {
    const auth = Buffer.from(`api:${apiKey}`).toString('base64');
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `https://api.mailgun.net/v3/${domain}/stats/total?event=accepted&start=${today}`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (!res.ok) return { used: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    const accepted = data?.stats?.[0]?.accepted?.total;
    return { used: typeof accepted === 'number' ? accepted : null };
  } catch (err) {
    return { used: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

const providerCheckers: Record<string, () => Promise<{ used: number | null; error?: string }>> = {
  sendgrid: checkSendGrid,
  mailjet: checkMailjet,
  mailtrap: checkMailtrap,
  resend: checkResend,
  mailgun: checkMailgun,
};

/**
 * Get accurate remaining capacity for all providers.
 * Queries provider APIs where possible, falls back to DB counts.
 * Returns ordered list: most remaining capacity first.
 */
export async function measureCapacity(): Promise<ProviderCapacityReport[]> {
  const providers = getProviders();

  // Get today's sent count from our DB
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const dbCounts = await prisma.recipient.groupBy({
    by: ['provider'],
    where: { status: 'sent', sentAt: { gte: todayStart } },
    _count: true,
  });
  const dbMap = new Map<string, number>();
  for (const row of dbCounts) {
    if (row.provider) dbMap.set(row.provider, row._count);
  }

  // Query each provider API in parallel
  const apiChecks = await Promise.allSettled(
    providers.map(async (p) => {
      const checker = providerCheckers[p.name];
      if (checker) {
        return { name: p.name, result: await checker() };
      }
      return { name: p.name, result: { used: null } as { used: number | null; error?: string } };
    })
  );

  const apiMap = new Map<string, { used: number | null; error?: string }>();
  for (const check of apiChecks) {
    if (check.status === 'fulfilled') {
      apiMap.set(check.value.name, check.value.result);
    }
  }

  const reports: ProviderCapacityReport[] = [];

  for (const provider of providers) {
    const dbSent = dbMap.get(provider.name) ?? 0;
    const apiResult = apiMap.get(provider.name);
    const providerReported = apiResult?.used ?? null;

    // Use the higher of API-reported or DB count for accuracy
    const actualUsed = providerReported !== null
      ? Math.max(providerReported, dbSent)
      : dbSent;

    const remaining = Math.max(0, provider.dailyLimit - actualUsed);
    const source: 'api' | 'db' | 'config' = providerReported !== null ? 'api' : dbSent > 0 ? 'db' : 'config';

    let status: 'available' | 'exhausted' | 'error' | 'inactive' = 'available';
    if (remaining === 0) status = 'exhausted';
    if (apiResult?.error) status = remaining === 0 ? 'exhausted' : 'available';

    reports.push({
      provider: provider.name,
      tier: provider.tier,
      configuredLimit: provider.dailyLimit,
      sentToday: actualUsed,
      providerReported,
      remaining,
      source,
      status,
      error: apiResult?.error,
    });
  }

  // Sort: available first, then by remaining capacity descending
  reports.sort((a, b) => {
    if (a.status === 'available' && b.status !== 'available') return -1;
    if (a.status !== 'available' && b.status === 'available') return 1;
    return b.remaining - a.remaining;
  });

  return reports;
}
