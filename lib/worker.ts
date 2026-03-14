/**
 * Background worker for processing email campaign batches.
 * Recipients are read from the DB (Recipient table) — no in-memory store.
 *
 * processBatch(campaignId, batchDay) sends all recipients assigned
 * to the given batchDay, grouped by their pre-assigned provider.
 * Each recipient is updated individually as sent/failed.
 */

import { prisma } from './prisma';
import { buildHtmlEmail } from './sendgrid';
import { getProviders, type EmailProvider } from './providers';

const BATCH_DELAY_MS = 1500;

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

/**
 * Process a single day's batch for a campaign.
 * Recipients should already have batchDay and provider assigned.
 */
export async function processBatch(campaignId: number, batchDay: number): Promise<void> {
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
    let firstErrorMessage: string | undefined;

    console.log(
      `[worker] Campaign ${campaignId} day ${batchDay}: sending ${batchRecipients.length} emails across ${byProvider.size} provider(s)`
    );

    // Process each provider's recipients
    for (const [providerName, recipients] of byProvider) {
      const provider = providers.find((p) => p.name === providerName);
      if (!provider) {
        console.error(`[worker] Provider "${providerName}" not found — marking recipients as failed`);
        await prisma.recipient.updateMany({
          where: { id: { in: recipients.map((r) => r.id) } },
          data: { status: 'failed', error: `Provider "${providerName}" not configured` },
        });
        continue;
      }

      let hitLimit = false;

      // Send in provider-sized batches
      for (let i = 0; i < recipients.length; i += provider.batchSize) {
        if (hitLimit) break;

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

        // Update each recipient's status
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
        }

        // Check for rate limit errors
        const failedResult = results.find((r) => !r.success);
        if (failedResult?.error) {
          if (!firstErrorMessage) firstErrorMessage = `[${providerName}] ${failedResult.error}`;
          if (isRateLimitError(failedResult.error)) {
            console.warn(`[worker] [${providerName}] rate-limit hit — stopping`);
            hitLimit = true;
            // Mark remaining unprocessed recipients for this provider back to pending
            const remaining = recipients.slice(i + provider.batchSize);
            if (remaining.length > 0) {
              await prisma.recipient.updateMany({
                where: { id: { in: remaining.map((r) => r.id) } },
                data: { batchDay: null, provider: null }, // return to pool for next batch
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
        if (i + provider.batchSize < recipients.length && !hitLimit) {
          await sleep(BATCH_DELAY_MS);
        }
      }
    }

    // Determine campaign status after this batch
    const pendingLeft = await prisma.recipient.count({
      where: { campaignId, status: 'pending' },
    });

    const finalStatus = pendingLeft > 0 ? 'paused' : 'completed';

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: finalStatus,
        ...(firstErrorMessage ? { errorMessage: firstErrorMessage } : {}),
      },
    });

    console.log(
      `[worker] Campaign ${campaignId} day ${batchDay} done → ${finalStatus}. ${pendingLeft} pending remaining.`
    );
  } catch (err) {
    console.error(`[worker] Campaign ${campaignId} batch ${batchDay} failed:`, err);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'paused', errorMessage: err instanceof Error ? err.message : 'Unknown error' },
    });
  }
}
