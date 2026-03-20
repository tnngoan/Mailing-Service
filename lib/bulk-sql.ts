/**
 * Bulk SQL operations via raw libsql/Prisma for performance.
 * Uses INSERT OR IGNORE for contacts (much faster than individual upserts).
 */

import { prisma, libsql } from './prisma';

const CHUNK = 500; // SQLite variable limit safe chunk

/**
 * Bulk-insert emails into Contact table, ignoring duplicates.
 * Uses raw SQL INSERT OR IGNORE for speed (~100x faster than Prisma upserts).
 */
export async function bulkUpsertContacts(emails: string[]): Promise<void> {
  if (emails.length === 0) return;

  if (libsql) {
    // Turso/libsql: use raw batch SQL
    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = emails.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?)').join(',');
      const args = chunk.flatMap((e) => [e, 'csv-upload']);
      await libsql.execute({
        sql: `INSERT OR IGNORE INTO Contact (email, source) VALUES ${placeholders}`,
        args,
      });
    }
  } else {
    // Local SQLite via Prisma: use raw executeRaw
    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = emails.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?)').join(',');
      const args = chunk.flatMap((e) => [e, 'csv-upload']);
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO Contact (email, source) VALUES ${placeholders}`,
        ...args
      );
    }
  }
}

/**
 * Bulk-insert recipients for a campaign.
 */
export async function bulkInsertRecipients(
  campaignId: number,
  recipients: { email: string; provider: string; priority: number; autoIncluded: boolean }[]
): Promise<void> {
  if (recipients.length === 0) return;

  if (libsql) {
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      const args = chunk.flatMap((r) => [
        campaignId, r.email, 'pending', r.provider, r.priority, r.autoIncluded ? 1 : 0,
      ]);
      await libsql.execute({
        sql: `INSERT INTO Recipient (campaignId, email, status, provider, priority, autoIncluded) VALUES ${placeholders}`,
        args,
      });
    }
  } else {
    // Prisma createMany for local
    for (let i = 0; i < recipients.length; i += 1000) {
      const chunk = recipients.slice(i, i + 1000);
      await prisma.recipient.createMany({
        data: chunk.map((r) => ({
          campaignId,
          email: r.email,
          status: 'pending',
          provider: r.provider,
          priority: r.priority,
          autoIncluded: r.autoIncluded,
        })),
      });
    }
  }
}
