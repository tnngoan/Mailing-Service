import type { EmailProvider, SendResult } from './types';

/**
 * SendPulse — free tier: 12,000 emails/month, 400/day, 50/hour.
 * Uses OAuth2 for authentication, then SMTP API to send.
 *
 * Auth: POST https://api.sendpulse.com/oauth/access_token
 * Send: POST https://api.sendpulse.com/smtp/emails
 *
 * Env: SENDPULSE_CLIENT_ID, SENDPULSE_CLIENT_SECRET
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`SendPulse OAuth failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    // Expire 60s early to avoid edge cases
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export function createSendPulseProvider(): EmailProvider | null {
  const clientId = (process.env.SENDPULSE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.SENDPULSE_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;

  const dailyLimit = parseInt(process.env.SENDPULSE_DAILY_LIMIT ?? '400', 10) || 400;

  return {
    name: 'sendpulse',
    dailyLimit,
    batchSize: 50, // stay within the 50/hour rate limit per batch
    async sendBatch(emails, subject, htmlBody, textBody, fromEmail, fromName) {
      try {
        const token = await getAccessToken(clientId, clientSecret);

        const res = await fetch('https://api.sendpulse.com/smtp/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: {
              html: htmlBody,
              text: textBody,
              subject,
              from: { name: fromName, email: fromEmail },
              to: emails.map((e) => ({ name: '', email: e })),
            },
          }),
        });

        if (res.ok) {
          return emails.map((email) => ({ success: true, email, provider: 'sendpulse' }));
        }

        const body = await res.json().catch(() => ({}));
        const detail = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        console.error('[sendpulse] rejected:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'sendpulse' }));
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : 'Unknown SendPulse error';
        console.error('[sendpulse] error:', detail);
        return emails.map((email) => ({ success: false, email, error: detail, provider: 'sendpulse' }));
      }
    },
  };
}
