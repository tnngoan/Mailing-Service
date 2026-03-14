/**
 * Common interface for all email-sending providers.
 * Each provider sends a batch of emails and reports per-recipient results.
 */

export interface SendResult {
  success: boolean;
  email: string;
  error?: string;
  provider: string;
}

export type ProviderTier = 'proven' | 'untested' | 'unreliable';

export interface EmailProvider {
  /** Short identifier shown in logs and UI (e.g. "sendgrid", "brevo") */
  name: string;
  /** Maximum emails this provider can handle per day */
  dailyLimit: number;
  /** Maximum recipients per single API call */
  batchSize: number;
  /** Reliability tier: proven > untested > unreliable */
  tier: ProviderTier;
  /** Send a batch of emails; returns one result per recipient */
  sendBatch(
    emails: string[],
    subject: string,
    htmlBody: string,
    textBody: string,
    fromEmail: string,
    fromName: string
  ): Promise<SendResult[]>;
}
