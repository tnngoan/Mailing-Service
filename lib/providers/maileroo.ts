import type { EmailProvider, SendResult } from './types';

/**
 * Maileroo — free tier: 3,000 emails/month, ~100/day.
 * Simple REST API with API key in header.
 *
 * Endpoint: POST https://smtp.maileroo.com/api/v2/emails
 * Docs: https://maileroo.com/docs/email-api/send-basic-email/
 */
export function createMailerooProvider(): EmailProvider | null {
  const apiKey = (process.env.MAILEROO_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.MAILEROO_DAILY_LIMIT ?? '100', 10) || 100;

  return {
    name: 'maileroo',
    dailyLimit,
    batchSize: 50,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://smtp.maileroo.com/api/v2/emails', {
          method: 'POST',
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: { email: fromEmail, name: fromName },
            to: emails.map((e) => ({ email: e })),
            subject,
            html: htmlBody,
            plain: textBody,
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'maileroo' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        console.error('[maileroo] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'maileroo' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Maileroo error';
        console.error('[maileroo] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'maileroo' }));
      }
    },
  };
}
