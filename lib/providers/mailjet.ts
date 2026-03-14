import type { EmailProvider, SendResult } from './types';

/**
 * Mailjet — free tier: 200 emails/day (6,000/month).
 * Uses the Send API v3.1 with Basic Auth (API key + secret).
 * Docs: https://dev.mailjet.com/email/reference/send-emails/
 */
export function createMailjetProvider(): EmailProvider | null {
  const apiKey = (process.env.MAILJET_API_KEY ?? '').trim();
  const secretKey = (process.env.MAILJET_SECRET_KEY ?? '').trim();
  if (!apiKey || !secretKey) return null;

  const dailyLimit = parseInt(process.env.MAILJET_DAILY_LIMIT ?? '200', 10) || 200;
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

  return {
    name: 'mailjet',
    dailyLimit,
    batchSize: 50, // Mailjet allows up to 50 recipients per message
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://api.mailjet.com/v3.1/send', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Messages: [
              {
                From: { Email: fromEmail, Name: fromName },
                To: emails.map((e) => ({ Email: e })),
                Subject: subject,
                TextPart: textBody,
                HTMLPart: htmlBody,
              },
            ],
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'mailjet' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { ErrorMessage?: string }).ErrorMessage ?? `HTTP ${res.status}`;
        console.error('[mailjet] batch rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailjet' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown Mailjet error';
        console.error('[mailjet] batch error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'mailjet' }));
      }
    },
  };
}
