import type { EmailProvider, SendResult } from './types';

/**
 * Mailtrap Bulk Sending — uses the bulk stream endpoint optimized for
 * high-volume marketing/newsletter sends.
 *
 * Free tier: 4,000 emails/month (~133/day).
 * Same API key works for both transactional and bulk endpoints.
 *
 * Bulk endpoint: https://bulk.api.mailtrap.io/api/send
 * Docs: https://api-docs.mailtrap.io/docs/mailtrap-api-docs/
 */
export function createMailtrapProvider(): EmailProvider | null {
  const apiKey = (process.env.MAILTRAP_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.MAILTRAP_DAILY_LIMIT ?? '150', 10) || 150;

  return {
    name: 'mailtrap',
    tier: 'proven',
    dailyLimit,
    batchSize: 50, // send in reasonable chunks; each call supports multiple "to" addresses
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://bulk.api.mailtrap.io/api/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: { email: fromEmail, name: fromName },
            to: emails.map((e) => ({ email: e })),
            subject,
            text: textBody,
            html: htmlBody,
            category: 'newsletter',
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'mailtrap' }));
        }

        const body = await res.json().catch(() => ({}));
        const errors = (body as { errors?: string[] }).errors;
        const detail = errors?.[0] ?? `HTTP ${res.status}`;
        console.error('[mailtrap] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailtrap' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Mailtrap error';
        console.error('[mailtrap] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailtrap' }));
      }
    },
  };
}
