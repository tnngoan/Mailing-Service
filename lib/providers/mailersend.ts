import type { EmailProvider, SendResult } from './types';

/**
 * MailerSend — free tier: 3,000 emails/month (~1,000/day claimed, but
 * actual daily cap may vary). Uses SMTP relay via nodemailer.
 */
export function createMailerSendProvider(): EmailProvider | null {
  const user = (process.env.MAILERSEND_SMTP_USER ?? '').trim();
  const pass = (process.env.MAILERSEND_SMTP_PASS ?? '').trim();
  if (!user || !pass) return null;

  const dailyLimit = parseInt(process.env.MAILERSEND_DAILY_LIMIT ?? '1000', 10) || 1000;

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.mailersend.net',
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  return {
    name: 'mailersend',
    tier: 'untested',
    dailyLimit,
    batchSize: 10,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      const results: SendResult[] = [];
      for (const email of emails) {
        try {
          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: email,
            subject,
            text: textBody,
            html: htmlBody,
          });
          results.push({ success: true, email, provider: 'mailersend' });
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : 'MailerSend SMTP error';
          results.push({ success: false, email, error: detail, provider: 'mailersend' });
        }
      }
      return results;
    },
  };
}
