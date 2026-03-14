import type { EmailProvider, SendResult } from './types';

/**
 * Mailgun — free tier: 100 emails/day (requires credit card to verify).
 * Uses the Messages API with Basic Auth.
 *
 * Endpoint: POST https://api.mailgun.net/v3/{domain}/messages
 * Docs: https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages
 */
export function createMailgunProvider(): EmailProvider | null {
  const apiKey = (process.env.MAILGUN_API_KEY ?? '').trim();
  const domain = (process.env.MAILGUN_DOMAIN ?? '').trim();
  if (!apiKey || !domain) return null;

  const dailyLimit = parseInt(process.env.MAILGUN_DAILY_LIMIT ?? '100', 10) || 100;
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');

  return {
    name: 'mailgun',
    dailyLimit,
    batchSize: 50, // Mailgun supports up to 1000 recipients per call
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        // Mailgun uses form-data, not JSON
        const formData = new URLSearchParams();
        formData.append('from', `${fromName} <${fromEmail}>`);
        emails.forEach((e) => formData.append('to', e));
        formData.append('subject', subject);
        formData.append('text', textBody);
        formData.append('html', htmlBody);

        const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'mailgun' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        console.error('[mailgun] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailgun' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Mailgun error';
        console.error('[mailgun] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailgun' }));
      }
    },
  };
}
