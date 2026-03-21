/**
 * Provider registry — auto-detects which email providers are configured
 * (have API keys set) and distributes emails across them proportional
 * to each provider's remaining daily capacity.
 *
 * Daily usage is tracked via the Recipient table — counting emails
 * sent today per provider. Resets automatically each calendar day.
 */

import type { EmailProvider, SendResult } from './types';
import { createMailerSendProvider } from './mailersend';   // 500/day free
import { createAhaSendProvider } from './ahasend';         // 33/day free
import { createSendPulseProvider } from './sendpulse';     // 400/day free
import { createBrevoProvider } from './brevo';             // 300/day free
import { createSmtp2goProvider } from './smtp2go';         // 200/day free
import { createMailjetProvider } from './mailjet';         // 200/day free
import { createMailtrapProvider } from './mailtrap';       // 150/day free
import { createSendGridProvider } from './sendgrid';       // 100/day free trial
import { createMailerooProvider } from './maileroo';       // 100/day free
import { createMailgunProvider } from './mailgun';         // 100/day free
import { createElasticEmailProvider } from './elasticemail'; // 100/day free
import { createResendProvider } from './resend';           // 100/day free

export type { EmailProvider, SendResult } from './types';

/** Returns all providers that have valid API keys configured, sorted by tier then speed. */
export function getProviders(): EmailProvider[] {
  const factories = [
    createMailerSendProvider,  // 500/day (trial: 500 unique recipients)
    createSendPulseProvider,   // 400/day
    createBrevoProvider,       // 300/day
    createSmtp2goProvider,     // 200/day
    createMailjetProvider,     // 200/day
    createMailtrapProvider,    // 150/day
    createSendGridProvider,    // 100/day
    createMailerooProvider,    // 100/day
    createMailgunProvider,     // 100/day
    createElasticEmailProvider, // 100/day
    createResendProvider,      // 100/day
    createAhaSendProvider,     // 33/day
  ];

  const tierOrder = { proven: 0, untested: 1, unreliable: 2 };

  // Optional: restrict to specific providers via ACTIVE_PROVIDERS env var (comma-separated)
  const activeFilter = (process.env.ACTIVE_PROVIDERS ?? '').trim().toLowerCase();
  const allowedNames = activeFilter ? activeFilter.split(',').map((s) => s.trim()).filter(Boolean) : null;

  const providers = factories
    .map((fn) => fn())
    .filter((p): p is EmailProvider => p !== null)
    .filter((p) => !allowedNames || allowedNames.includes(p.name))
    // Proven first, then untested, then unreliable. Within same tier, biggest capacity first.
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.dailyLimit - a.dailyLimit);

  if (providers.length === 0) {
    console.error('[providers] No email providers configured — set at least one API key');
  } else {
    console.log(
      `[providers] Active (${providers.length}): ${providers.map((p) => `${p.name} (${p.dailyLimit}/day)`).join(', ')}`
    );
  }

  return providers;
}

/** Total daily sending capacity across all configured providers. */
export function getTotalDailyLimit(): number {
  return getProviders().reduce((sum, p) => sum + p.dailyLimit, 0);
}

export interface ProviderAllocation {
  provider: EmailProvider;
  emails: string[];
}

export interface ProviderCapacity {
  provider: EmailProvider;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
}

/**
 * Query the DB for how many emails each provider has already sent today.
 * Returns providers with their remaining capacity, excluding exhausted ones.
 */
export async function getProviderCapacities(): Promise<ProviderCapacity[]> {
  // Lazy import to avoid circular deps
  const { prisma } = await import('@/lib/prisma');

  const providers = getProviders();

  // Get start of today (UTC)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Count emails sent today per provider (status = 'sent' and sentAt >= today)
  const usageCounts = await prisma.recipient.groupBy({
    by: ['provider'],
    where: {
      status: 'sent',
      sentAt: { gte: todayStart },
    },
    _count: true,
  });

  const usageMap = new Map<string, number>();
  for (const row of usageCounts) {
    if (row.provider) {
      usageMap.set(row.provider, row._count);
    }
  }

  const capacities: ProviderCapacity[] = [];
  for (const provider of providers) {
    const usedToday = usageMap.get(provider.name) ?? 0;
    const remaining = Math.max(0, provider.dailyLimit - usedToday);
    capacities.push({ provider, dailyLimit: provider.dailyLimit, usedToday, remaining });

    if (remaining === 0) {
      console.log(`[providers] ${provider.name}: daily limit reached (${usedToday}/${provider.dailyLimit}) — skipping`);
    } else {
      console.log(`[providers] ${provider.name}: ${usedToday}/${provider.dailyLimit} used, ${remaining} remaining`);
    }
  }

  return capacities;
}

/**
 * Get total remaining capacity across all providers for today.
 */
export async function getRemainingDailyCapacity(): Promise<number> {
  const capacities = await getProviderCapacities();
  return capacities.reduce((sum, c) => sum + c.remaining, 0);
}

/**
 * Assign a fixed provider segment to all recipients in a campaign.
 * Each provider gets a deterministic, non-overlapping slice of the
 * full recipient list (sorted by id). This ensures a provider always
 * handles the same set of addresses across daily batches.
 *
 * Example with 1000 recipients and capacities [mailersend:1000, mailjet:200, ...]:
 *   mailersend → recipients 1-690 (proportional to 1000/1450)
 *   mailjet    → recipients 691-828
 *   mailtrap   → recipients 829-932
 *   sendgrid   → recipients 933-1000
 *
 * Returns the segment boundaries for reference.
 */
export interface ProviderSegment {
  provider: EmailProvider;
  startIndex: number;  // inclusive
  endIndex: number;    // exclusive
  count: number;
}

export function assignProviderSegments(
  totalRecipients: number,
  providers: EmailProvider[]
): ProviderSegment[] {
  if (providers.length === 0 || totalRecipients === 0) return [];

  const totalLimit = providers.reduce((s, p) => s + p.dailyLimit, 0);
  const segments: ProviderSegment[] = [];
  let offset = 0;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    const count = isLast
      ? totalRecipients - offset
      : Math.round((provider.dailyLimit / totalLimit) * totalRecipients);

    if (count > 0) {
      segments.push({
        provider,
        startIndex: offset,
        endIndex: offset + count,
        count,
      });
      offset += count;
    }
  }

  return segments;
}

/**
 * Pick today's batch from pre-assigned provider segments.
 * Only takes up to each provider's remaining daily capacity.
 * Providers that have hit their limit are skipped entirely.
 */
/**
 * Reassign pending recipients from one provider to all other available providers.
 * Used when a provider is broken/exhausted and its pending emails are stuck.
 * Returns the count of reassigned recipients per target provider.
 */
export async function reassignProviderEmails(
  campaignId: number,
  fromProvider: string
): Promise<{ reassigned: number; breakdown: { provider: string; count: number }[] }> {
  const { prisma } = await import('@/lib/prisma');

  const providers = getProviders().filter((p) => p.name !== fromProvider);
  if (providers.length === 0) {
    return { reassigned: 0, breakdown: [] };
  }

  // Count pending recipients assigned to the broken provider
  const pendingCount = await prisma.recipient.count({
    where: { campaignId, provider: fromProvider, status: 'pending' },
  });

  if (pendingCount === 0) {
    return { reassigned: 0, breakdown: [] };
  }

  // Get IDs of all pending recipients for this provider
  const pendingRecipients = await prisma.recipient.findMany({
    where: { campaignId, provider: fromProvider, status: 'pending' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  // Distribute proportionally across remaining providers by dailyLimit
  const totalLimit = providers.reduce((s, p) => s + p.dailyLimit, 0);
  const breakdown: { provider: string; count: number }[] = [];
  let offset = 0;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    const count = isLast
      ? pendingRecipients.length - offset
      : Math.round((provider.dailyLimit / totalLimit) * pendingRecipients.length);

    if (count > 0) {
      const ids = pendingRecipients.slice(offset, offset + count).map((r) => r.id);
      await prisma.recipient.updateMany({
        where: { id: { in: ids } },
        data: { provider: provider.name },
      });
      breakdown.push({ provider: provider.name, count });
      offset += count;
    }
  }

  console.log(
    `[reassign] Moved ${offset} recipients from ${fromProvider} → ${breakdown.map((b) => `${b.provider}(${b.count})`).join(', ')}`
  );

  return { reassigned: offset, breakdown };
}

export function allocateEmailsWithCapacity(
  emails: string[],
  capacities: ProviderCapacity[]
): ProviderAllocation[] {
  // Filter out exhausted providers
  const available = capacities.filter((c) => c.remaining > 0);
  if (available.length === 0) return [];

  const totalRemaining = available.reduce((s, c) => s + c.remaining, 0);
  const toAllocate = Math.min(emails.length, totalRemaining);

  if (toAllocate === 0) return [];

  const allocations: ProviderAllocation[] = [];
  let offset = 0;

  for (let i = 0; i < available.length; i++) {
    const { provider, remaining } = available[i];
    const isLast = i === available.length - 1;

    // Proportional to remaining capacity, capped at provider's remaining limit
    const proportional = isLast
      ? toAllocate - offset
      : Math.round((remaining / totalRemaining) * toAllocate);

    const count = Math.min(proportional, remaining);

    if (count > 0) {
      allocations.push({
        provider,
        emails: emails.slice(offset, offset + count),
      });
      offset += count;
    }
  }

  return allocations;
}
