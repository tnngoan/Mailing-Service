import type { EmailProvider, SendResult } from './types';

/**
 * MailerSend — free trial: 3,000 emails/month, 500 unique recipients limit.
 * Uses SMTP relay via nodemailer with rate limiting (1 email per second)
 * to avoid 450 Too Many Requests errors.
 */
export function createMailerSendProvider(): EmailProvider | null {
  const user = (process.env.MAILERSEND_SMTP_USER ?? '').trim();
  const pass = (process.env.MAILERSEND_SMTP_PASS ?? '').trim();
  if (!user || !pass) return null;

  const dailyLimit = parseInt(process.env.MAILERSEND_DAILY_LIMIT ?? '500', 10) || 500;

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.mailersend.net',
    port: 587,
    secure: false,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
    rateDelta: 1000,  // 1 email per second
    rateLimit: 1,
  });

  return {
    name: 'mailersend',
    tier: 'unreliable',
    dailyLimit,
    batchSize: 5, // smaller batches to stay under rate limit
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
          // Throttle: wait 1.2s between sends to avoid rate limit
          if (emails.indexOf(email) < emails.length - 1) {
            await new Promise((r) => setTimeout(r, 1200));
          }
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : 'MailerSend SMTP error';
          results.push({ success: false, email, error: detail, provider: 'mailersend' });

          // If rate limited or unique recipient limit, stop immediately
          if (detail.includes('Too many requests') || detail.includes('unique recipients limit')) {
            // Mark remaining emails as failed with same error
            const remaining = emails.slice(emails.indexOf(email) + 1);
            for (const rem of remaining) {
              results.push({ success: false, email: rem, error: detail, provider: 'mailersend' });
            }
            break;
          }
        }
      }
      return results;
    },
  };
}
