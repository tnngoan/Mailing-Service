import type { EmailProvider, SendResult } from './types';

/**
 * Elastic Email — free tier: 100 emails/day, 3K/month.
 * Uses REST API v4 with API key in header.
 *
 * Endpoint: POST https://api.elasticemail.com/v4/emails/transactional
 * Docs: https://elasticemail.com/developers/api-documentation/rest-api
 */
export function createElasticEmailProvider(): EmailProvider | null {
  const apiKey = (process.env.ELASTICEMAIL_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.ELASTICEMAIL_DAILY_LIMIT ?? '100', 10) || 100;

  return {
    name: 'elasticemail',
    dailyLimit,
    batchSize: 50,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://api.elasticemail.com/v4/emails/transactional', {
          method: 'POST',
          headers: {
            'X-ElasticEmail-ApiKey': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Recipients: {
              To: emails.map((e) => e),
            },
            Content: {
              From: `${fromName} <${fromEmail}>`,
              Subject: subject,
              Body: [
                { ContentType: 'HTML', Content: htmlBody },
                { ContentType: 'PlainText', Content: textBody },
              ],
            },
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'elasticemail' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { Error?: string }).Error ?? `HTTP ${res.status}`;
        console.error('[elasticemail] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'elasticemail' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Elastic Email error';
        console.error('[elasticemail] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'elasticemail' }));
      }
    },
  };
}
