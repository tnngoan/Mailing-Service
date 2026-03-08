import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// On Vercel the DATABASE_URL points to /tmp which is empty on every cold start.
// This creates the Campaign table if it doesn't exist yet — idempotent, fast.
let schemaInitialised = false;

export async function ensureSchema(): Promise<void> {
  if (schemaInitialised) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Campaign" (
        "id"              INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
        "subject"         TEXT     NOT NULL,
        "content"         TEXT     NOT NULL,
        "status"          TEXT     NOT NULL DEFAULT 'queued',
        "totalRecipients" INTEGER  NOT NULL DEFAULT 0,
        "sentCount"       INTEGER  NOT NULL DEFAULT 0,
        "failedCount"     INTEGER  NOT NULL DEFAULT 0,
        "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    schemaInitialised = true;
  } catch (err) {
    // Log but don't crash — table may already exist through a normal migration
    console.error('[ensureSchema] warning:', err);
  }
}
