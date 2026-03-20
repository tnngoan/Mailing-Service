import sgMail from '@sendgrid/mail';
import type { EmailProvider, SendResult } from './types';

export function createSendGridProvider(): EmailProvider | null {
  const apiKey = (process.env.SENDGRID_API_KEY ?? '').trim();
  if (!apiKey) return null;

  sgMail.setApiKey(apiKey);

  const dailyLimit = parseInt(process.env.SENDGRID_DAILY_LIMIT ?? '2000', 10) || 2000;

  return {
    name: 'sendgrid',
    tier: 'proven',
    dailyLimit,
    batchSize: 500, // well under SendGrid's 1000 personalizations limit
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        await sgMail.send({
          personalizations: emails.map((to) => ({ to: [{ email: to }] })),
          from: { email: fromEmail, name: fromName },
          subject,
          text: textBody,
          html: htmlBody,
        });
        return emails.map((email) => ({ success: true, email, provider: 'sendgrid' }));
      } catch (err: unknown) {
        const sgErr = err as {
          message?: string;
          response?: { body?: { errors?: { message: string }[] } };
        };
        const detail =
          sgErr?.response?.body?.errors?.[0]?.message ??
          sgErr?.message ??
          'Unknown SendGrid error';
        console.error('[sendgrid] batch rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'sendgrid' }));
      }
    },
  };
}
