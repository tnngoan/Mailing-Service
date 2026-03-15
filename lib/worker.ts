/**
 * Background worker for processing email campaign batches.
 * Recipients are read from the DB (Recipient table) — no in-memory store.
 *
 * processBatch(campaignId, batchDay) sends all recipients assigned
 * to the given batchDay, grouped by their pre-assigned provider.
 * Each recipient is updated individually as sent/failed.
 *
 * If 10 consecutive failures occur for a provider, it is skipped
 * and remaining recipients are returned to the pending pool.
 * A diagnostic report is stored in the campaign's errorMessage.
 */

import { prisma } from './prisma';
import { buildHtmlEmail } from './sendgrid';
import { getProviders, type EmailProvider } from './providers';

const BATCH_DELAY_MS = 1500;
const CONSECUTIVE_FAIL_THRESHOLD = 10;

const SENDER_EMAIL = (process.env.SENDER_EMAIL ?? '').trim();
const SENDER_NAME = (process.env.SENDER_NAME ?? 'Newsletter').trim();

const RATE_LIMIT_PATTERNS = [
  'exceed', 'rate limit', 'too many requests',
  'quota', 'limit reached', 'throttl', '429',
];

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProviderDiagnostic {
  provider: string;
  status: 'ok' | 'skipped' | 'failed';
  assigned: number;
  sent: number;
  failed: number;
  skipped: number;
  reason?: string;
  errors: string[];
}

function diagnoseErrors(errors: string[]): string {
  const lower = errors.map((e) => e.toLowerCase());

  if (lower.some((e) => e.includes('domain') && (e.includes('not verified') || e.includes('blocked'))))
    return 'Domain not verified — verify trada.ink in provider dashboard';
  if (lower.some((e) => e.includes('unauthorized') || e.includes('authentication') || e.includes('invalid login')))
    return 'API key or credentials are invalid — check provider settings';
  if (lower.some((e) => e.includes('suspended') || e.includes('blocked') || e.includes('deactivated')))
    return 'Account suspended or blocked — contact provider support';
  if (lower.some((e) => RATE_LIMIT_PATTERNS.some((p) => e.includes(p))))
    return 'Daily sending limit reached — will retry tomorrow';
  if (lower.some((e) => e.includes('not activated')))
    return 'SMTP/API account not activated — contact provider to activate';
  if (lower.some((e) => e.includes('timeout') || e.includes('econnrefused') || e.includes('network')))
    return 'Network/connection error — provider may be temporarily down';
  if (lower.some((e) => e.includes('sender') && e.includes('not valid')))
    return 'Sender email not verified — add goodmorning@trada.ink as verified sender';

  return 'Unknown error — check error details';
}

/**
 * Process a single day's batch for a campaign.
 * Recipients should already have batchDay and provider assigned.
 */
export async function processBatch(campaignId: number, batchDay: number): Promise<void> {
  const diagnostics: ProviderDiagnostic[] = [];

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      console.error(`[worker] Campaign ${campaignId} not found`);
      return;
    }

    // Get all recipients for this batch, grouped by provider
    const batchRecipients = await prisma.recipient.findMany({
      where: { campaignId, batchDay, status: 'pending' },
      orderBy: { id: 'asc' },
    });

    if (batchRecipients.length === 0) {
      console.warn(`[worker] Campaign ${campaignId} batch ${batchDay}: no pending recipients`);
      return;
    }

    const htmlBody = buildHtmlEmail(campaign.content, campaign.subject);
    const textBody = campaign.content;

    // Group recipients by provider
    const byProvider = new Map<string, typeof batchRecipients>();
    for (const r of batchRecipients) {
      const key = r.provider ?? 'unknown';
      const list = byProvider.get(key) ?? [];
      list.push(r);
      byProvider.set(key, list);
    }

    const providers = getProviders();

    console.log(
      `[worker] Campaign ${campaignId} day ${batchDay}: sending ${batchRecipients.length} emails across ${byProvider.size} provider(s)`
    );

    // Process each provider's recipients
    for (const [providerName, recipients] of byProvider) {
      const diag: ProviderDiagnostic = {
        provider: providerName,
        status: 'ok',
        assigned: recipients.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: [],
      };

      const provider = providers.find((p) => p.name === providerName);
      if (!provider) {
        console.error(`[worker] Provider "${providerName}" not found — marking recipients as failed`);
        await prisma.recipient.updateMany({
          where: { id: { in: recipients.map((r) => r.id) } },
          data: { status: 'failed', error: `Provider "${providerName}" not configured` },
        });
        diag.status = 'failed';
        diag.failed = recipients.length;
        diag.reason = `Provider "${providerName}" not configured`;
        diagnostics.push(diag);
        continue;
      }

      let consecutiveFails = 0;
      let skipProvider = false;

      // Send in provider-sized batches
      for (let i = 0; i < recipients.length; i += provider.batchSize) {
        if (skipProvider) {
          // Return remaining to pending pool
          const remaining = recipients.slice(i);
          diag.skipped += remaining.length;
          await prisma.recipient.updateMany({
            where: { id: { in: remaining.map((r) => r.id) } },
            data: { batchDay: null },
          });
          break;
        }

        const batch = recipients.slice(i, i + provider.batchSize);
        const emails = batch.map((r) => r.email);

        console.log(
          `[worker] [${providerName}] batch ${Math.floor(i / provider.batchSize) + 1} (${batch.length} emails)`
        );

        const results = await provider.sendBatch(
          emails,
          campaign.subject,
          htmlBody,
          textBody,
          SENDER_EMAIL,
          SENDER_NAME
        );

        // Update each recipient's status and track consecutive failures
        const now = new Date();
        for (const result of results) {
          const recipient = batch.find((r) => r.email === result.email);
          if (!recipient) continue;

          await prisma.recipient.update({
            where: { id: recipient.id },
            data: {
              status: result.success ? 'sent' : 'failed',
              sentAt: result.success ? now : null,
              error: result.error ?? null,
            },
          });

          if (result.success) {
            diag.sent++;
            consecutiveFails = 0; // reset on success
          } else {
            diag.failed++;
            consecutiveFails++;

            // Track unique errors
            if (result.error && !diag.errors.includes(result.error)) {
              diag.errors.push(result.error);
            }

            // Check if we hit the consecutive failure threshold
            if (consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) {
              console.warn(
                `[worker] [${providerName}] ${CONSECUTIVE_FAIL_THRESHOLD} consecutive failures — skipping provider`
              );
              skipProvider = true;
              diag.status = 'skipped';
              diag.reason = diagnoseErrors(diag.errors);

              // Return ALL remaining unprocessed recipients to pending
              const remaining = recipients.slice(i + provider.batchSize);
              diag.skipped += remaining.length;
              if (remaining.length > 0) {
                await prisma.recipient.updateMany({
                  where: { id: { in: remaining.map((r) => r.id) } },
                  data: { batchDay: null },
                });
              }
              break;
            }
          }
        }

        // Also check for rate limit in batch-level errors
        if (!skipProvider) {
          const failedResult = results.find((r) => !r.success);
          if (failedResult?.error && isRateLimitError(failedResult.error)) {
            console.warn(`[worker] [${providerName}] rate-limit hit — stopping`);
            skipProvider = true;
            diag.status = 'skipped';
            diag.reason = 'Daily sending limit reached — will retry tomorrow';

            const remaining = recipients.slice(i + provider.batchSize);
            diag.skipped += remaining.length;
            if (remaining.length > 0) {
              await prisma.recipient.updateMany({
                where: { id: { in: remaining.map((r) => r.id) } },
                data: { batchDay: null },
              });
            }
          }
        }

        // Update campaign aggregate counts
        const counts = await prisma.recipient.groupBy({
          by: ['status'],
          where: { campaignId },
          _count: true,
        });
        const sentCount = counts.find((c) => c.status === 'sent')?._count ?? 0;
        const failedCount = counts.find((c) => c.status === 'failed')?._count ?? 0;

        await prisma.campaign.update({
          where: { id: campaignId },
          data: { sentCount, failedCount },
        });

        // Delay between batches
        if (!skipProvider && i + provider.batchSize < recipients.length) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      if (!skipProvider && diag.failed === 0) {
        diag.status = 'ok';
      } else if (!skipProvider && diag.failed > 0 && diag.sent > 0) {
        diag.status = 'ok'; // partial success is still ok
        diag.reason = diagnoseErrors(diag.errors);
      } else if (!skipProvider && diag.failed > 0 && diag.sent === 0) {
        diag.status = 'failed';
        diag.reason = diagnoseErrors(diag.errors);
      }

      diagnostics.push(diag);
    }

    // Determine campaign status after this batch
    const pendingLeft = await prisma.recipient.count({
      where: { campaignId, status: 'pending' },
    });

    const finalStatus = pendingLeft > 0 ? 'paused' : 'completed';

    // Build error report from diagnostics
    const problemProviders = diagnostics.filter((d) => d.status !== 'ok');
    const errorReport = diagnostics.length > 0
      ? JSON.stringify(diagnostics)
      : null;

    const summaryMessage = problemProviders.length > 0
      ? problemProviders.map((d) => `[${d.provider}] ${d.reason}`).join(' | ')
      : null;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: finalStatus,
        errorMessage: errorReport,
      },
    });

    console.log(
      `[worker] Campaign ${campaignId} day ${batchDay} done → ${finalStatus}. ${pendingLeft} pending remaining.`
    );
    if (problemProviders.length > 0) {
      console.warn(`[worker] Issues: ${summaryMessage}`);
    }
  } catch (err) {
    console.error(`[worker] Campaign ${campaignId} batch ${batchDay} failed:`, err);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'paused',
        errorMessage: JSON.stringify([
          ...diagnostics,
          { provider: 'system', status: 'failed', reason: err instanceof Error ? err.message : 'Unknown error', assigned: 0, sent: 0, failed: 0, skipped: 0, errors: [] }
        ]),
      },
    });
  }
}
