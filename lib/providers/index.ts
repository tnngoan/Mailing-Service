/**
 * Provider registry — auto-detects which email providers are configured
 * (have API keys set) and distributes emails across them proportional
 * to each provider's daily limit.
 *
 * Providers are sorted by daily limit (highest first) so the biggest
 * capacity providers handle the bulk of the work.
 */

import type { EmailProvider, SendResult } from './types';
import { createMailerSendProvider } from './mailersend';   // 1000/day free
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

/** Returns all providers that have valid API keys configured, sorted by daily limit desc. */
export function getProviders(): EmailProvider[] {

  // Ordered by free-tier daily limit (highest first)
  const factories = [
    createMailerSendProvider,  // 1000/day
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
  ];

  const tierOrder = { proven: 0, untested: 1, unreliable: 2 };
  const providers = factories
    .map((fn) => fn())
    .filter((p): p is EmailProvider => p !== null)
    // Proven first, then untested, then unreliable. Within same tier, fastest (biggest batch) first.
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.batchSize - a.batchSize || b.dailyLimit - a.dailyLimit);

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

/**
 * Split an email list across providers proportional to their daily limits.
 *
 * Example: 1,350 emails with all 8 providers configured
 *  → SendPulse gets ~400, Brevo gets ~300, SMTP2GO gets ~200, etc.
 */
export function allocateEmails(emails: string[]): ProviderAllocation[] {
  const providers = getProviders();
  if (providers.length === 0) return [];
  if (providers.length === 1) {
    return [{ provider: providers[0], emails }];
  }

  const totalLimit = providers.reduce((s, p) => s + p.dailyLimit, 0);
  const allocations: ProviderAllocation[] = [];
  let offset = 0;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;

    // Last provider gets whatever remains (avoids rounding issues)
    const count = isLast
      ? emails.length - offset
      : Math.round((provider.dailyLimit / totalLimit) * emails.length);

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
