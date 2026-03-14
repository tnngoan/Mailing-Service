import type { EmailProvider, SendResult } from './types';

/**
 * Brevo (formerly Sendinblue) — free tier: 300 emails/day.
 * Supports both REST API key and SMTP key (xsmtpsib- prefix).
 * For REST: use api-key from Brevo dashboard (Settings > API Keys)
 * For SMTP: set BREVO_LOGIN to your Brevo account email
 */
export function createBrevoProvider(): EmailProvider | null {
  const apiKey = (process.env.BREVO_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const dailyLimit = parseInt(process.env.BREVO_DAILY_LIMIT ?? '300', 10) || 300;
  const isSmtpKey = apiKey.startsWith('xsmtpsib-');

  // SMTP keys need a login email — skip if not provided
  if (isSmtpKey) {
    const login = (process.env.BREVO_LOGIN ?? '').trim();
    if (!login) {
      console.warn('[brevo] SMTP key detected but BREVO_LOGIN not set — skipping. Set BREVO_LOGIN to your Brevo account email.');
      return null;
    }

    // Dynamic import nodemailer only when needed
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: login, pass: apiKey },
    });

    return {
      name: 'brevo',
      tier: 'unreliable',
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
            results.push({ success: true, email, provider: 'brevo' });
          } catch (err: unknown) {
            const detail = err instanceof Error ? err.message : 'Brevo SMTP error';
            results.push({ success: false, email, error: detail, provider: 'brevo' });
          }
        }
        return results;
      },
    };
  }

  // REST API key path
  return {
    name: 'brevo',
    tier: 'unreliable',
    dailyLimit,
    batchSize: 50,
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { email: fromEmail, name: fromName },
            to: emails.map((e) => ({ email: e })),
            subject,
            htmlContent: htmlBody,
            textContent: textBody,
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'brevo' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'brevo' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Brevo error';
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'brevo' }));
      }
    },
  };
}
