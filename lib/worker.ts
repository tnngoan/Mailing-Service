/**
 * Background worker for processing email campaigns.
 *
 * Runs in the same Node.js process as the Next.js server.
 * Uses an async loop with intentional delays between batches
 * to stay within SendGrid rate limits.
 *
 * For very large lists (500k+) on serverless (Vercel), consider
 * moving this to a separate long-running service (Railway / Render).
 */

import { prisma } from './prisma';
import { sendBatch } from './sendgrid';

const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1500; // 1.5s between batches

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processCampaign(campaignId: number): Promise<void> {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      console.error(`[worker] Campaign ${campaignId} not found`);
      return;
    }

    const totalRecipients = await prisma.email.count();

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sending', totalRecipients, sentCount: 0, failedCount: 0 },
    });

    let cursor: number | undefined = undefined;
    let sentCount = 0;
    let failedCount = 0;

    while (true) {
      const batch: { id: number; email: string }[] =
        cursor !== undefined
          ? await prisma.email.findMany({
              take: BATCH_SIZE,
              skip: 1,
              cursor: { id: cursor },
              orderBy: { id: 'asc' },
              select: { id: true, email: true },
            })
          : await prisma.email.findMany({
              take: BATCH_SIZE,
              orderBy: { id: 'asc' },
              select: { id: true, email: true },
            });

      if (batch.length === 0) break;

      const emailAddresses = batch.map((e) => e.email);

      console.log(
        `[worker] Campaign ${campaignId}: sending batch of ${batch.length} (total sent so far: ${sentCount})`
      );

      const results = await sendBatch(
        emailAddresses,
        campaign.subject,
        campaign.content
      );

      const batchSent = results.filter((r) => r.success).length;
      const batchFailed = results.filter((r) => !r.success).length;

      if (batchFailed > 0) {
        // Log the first failure reason so it's visible in the terminal
        const firstError = results.find((r) => !r.success);
        console.error(
          `[worker] Campaign ${campaignId}: ${batchFailed} failed in this batch. Reason: ${firstError?.error}`
        );
      }

      sentCount += batchSent;
      failedCount += batchFailed;

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sentCount, failedCount },
      });

      cursor = batch[batch.length - 1].id;

      if (batch.length < BATCH_SIZE) break; // last batch

      await sleep(BATCH_DELAY_MS);
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
  }
}
