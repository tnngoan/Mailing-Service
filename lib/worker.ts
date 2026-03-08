/**
 * Background worker for processing email campaigns.
 * Email addresses are read from the in-memory store (never from the DB).
 * The store entry is cleared once sending completes or fails.
 */

import { prisma } from './prisma';
import { sendBatch } from './sendgrid';
import { getEmails, clearEmails } from './email-store';

const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1500; // 1.5 s between batches — stays within SendGrid rate limits

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processCampaign(campaignId: number): Promise<void> {
  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });

    if (!campaign) {
      console.error(`[worker] Campaign ${campaignId} not found`);
      return;
    }

    const emails = getEmails(campaignId);

    if (emails.length === 0) {
      console.error(`[worker] Campaign ${campaignId}: no emails in store`);
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'failed' },
      });
      return;
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sending', totalRecipients: emails.length, sentCount: 0, failedCount: 0 },
    });

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);

      console.log(
        `[worker] Campaign ${campaignId}: sending batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} emails, ${sentCount} sent so far)`
      );

      const results = await sendBatch(batch, campaign.subject, campaign.content);

      const batchSent = results.filter((r) => r.success).length;
      const batchFailed = results.filter((r) => !r.success).length;

      if (batchFailed > 0) {
        const firstError = results.find((r) => !r.success);
        console.error(
          `[worker] Campaign ${campaignId}: ${batchFailed} failed. Reason: ${firstError?.error}`
        );
      }

      sentCount += batchSent;
      failedCount += batchFailed;

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sentCount, failedCount },
      });

      // Delay between batches unless this was the last one
      if (i + BATCH_SIZE < emails.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', sentCount, failedCount },
    });

    console.log(
      `[worker] Campaign ${campaignId} completed. Sent: ${sentCount}, Failed: ${failedCount}`
    );
  } catch (err) {
    console.error(`[worker] Campaign ${campaignId} failed:`, err);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'failed' },
    });
  } finally {
    clearEmails(campaignId);
  }
}
