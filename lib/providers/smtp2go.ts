import type { EmailProvider, SendResult } from './types';

/**
 * SMTP2GO — free tier: 1,000 emails/month, 200/day.
 * Simple REST API with API key auth.
 *
 * Endpoint: POST https://api.smtp2go.com/v3/email/send
 * Docs: https://developers.smtp2go.com/docs/send-an-email
 */
export function createSmtp2goProvider(): EmailProvider | null {
  const apiKey = (process.env.SMTP2GO_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.SMTP2GO_DAILY_LIMIT ?? '200', 10) || 200;

  return {
    name: 'smtp2go',
    tier: 'untested',
    dailyLimit,
    batchSize: 50,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://api.smtp2go.com/v3/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            sender: `${fromName} <${fromEmail}>`,
            to: emails,
            subject,
            text_body: textBody,
            html_body: htmlBody,
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'smtp2go' }));
        }

        const body = await res.json().catch(() => ({}));
        const data = body as { data?: { error?: string; error_code?: string } };
        const detail = data?.data?.error ?? `HTTP ${res.status}`;
        console.error('[smtp2go] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'smtp2go' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown SMTP2GO error';
        console.error('[smtp2go] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'smtp2go' }));
      }
    },
  };
}
