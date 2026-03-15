import type { EmailProvider, SendResult } from './types';

/**
 * Resend — free tier: 100 emails/day (3,000/month).
 * Uses the Emails API with direct fetch.
 * Note: Resend doesn't support batch sends, so we send individually.
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
export function createResendProvider(): EmailProvider | null {
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.RESEND_DAILY_LIMIT ?? '100', 10) || 100;

  return {
    name: 'resend',
    tier: 'proven',
    dailyLimit,
    batchSize: 50, // Resend batch endpoint supports up to 100
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        // Resend supports a batch endpoint
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            emails.map((to) => ({
              from: `${fromName} <${fromEmail}>`,
              to: [to],
              subject,
              html: htmlBody,
              text: textBody,
            }))
          ),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'resend' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        console.error('[resend] batch rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'resend' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Resend error';
        console.error('[resend] batch error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'resend' }));
      }
    },
  };
}
