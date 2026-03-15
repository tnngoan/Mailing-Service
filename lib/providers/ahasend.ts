import type { EmailProvider, SendResult } from './types';

/**
 * AhaSend — free tier: 1,000 emails/month (~33/day).
 * Uses REST API v2 with Bearer auth.
 * Docs: https://ahasend.com/docs/api-reference
 */
export function createAhaSendProvider(): EmailProvider | null {
  const apiKey = (process.env.AHASEND_API_KEY ?? '').trim();
  const accountId = (process.env.AHASEND_ACCOUNT_ID ?? '').trim();
  if (!apiKey || !accountId) return null;

  const dailyLimit = parseInt(process.env.AHASEND_DAILY_LIMIT ?? '33', 10) || 33;

  return {
    name: 'ahasend',
    tier: 'untested',
    dailyLimit,
    batchSize: 5,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      const results: SendResult[] = [];

      for (const email of emails) {
        try {
          const res = await fetch(
            `https://api.ahasend.com/v2/accounts/${accountId}/messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: { email: fromEmail, name: fromName },
                recipients: [{ email }],
                subject,
                html_content: htmlBody,
                text_content: textBody,
              }),
            }
          );

          if (res.ok) {
            results.push({ success: true, email, provider: 'ahasend' });
          } else {
            const body = await res.json().catch(() => ({}));
            const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
            results.push({ success: false, email, error: detail, provider: 'ahasend' });

            // Stop on rate limit
            if (res.status === 429) {
              const remaining = emails.slice(emails.indexOf(email) + 1);
              for (const rem of remaining) {
                results.push({ success: false, email: rem, error: 'Rate limited', provider: 'ahasend' });
              }
              break;
            }
          }

          // Throttle: 1 request per second
          if (emails.indexOf(email) < emails.length - 1) {
            await new Promise((r) => setTimeout(r, 1200));
          }
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : 'AhaSend error';
          results.push({ success: false, email, error: detail, provider: 'ahasend' });
        }
      }

      return results;
    },
  };
}
