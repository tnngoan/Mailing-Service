import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient, type Client } from '@libsql/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  libsqlClient: Client | undefined;
};

function getLibsqlClient(): Client | null {
  const tursoUrl = (process.env.TURSO_DATABASE_URL ?? '').trim();
  const tursoToken = (process.env.TURSO_AUTH_TOKEN ?? '').trim();
  if (!tursoUrl) return null;
  return createClient({ url: tursoUrl, authToken: tursoToken || undefined });
}

function buildPrisma(): PrismaClient {
  const libsql = getLibsqlClient();
  if (libsql) {
    const adapter = new PrismaLibSQL(libsql);
    return new PrismaClient({ adapter });
  }
  return new PrismaClient({ log: ['error'] });
}

// Expose raw libsql client for bulk SQL operations (INSERT OR IGNORE, etc.)
export const libsql: Client | null = globalForPrisma.libsqlClient ?? getLibsqlClient();
export const prisma = globalForPrisma.prisma ?? buildPrisma();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  if (libsql) globalForPrisma.libsqlClient = libsql;
}
