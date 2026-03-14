import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildPrisma(): PrismaClient {
  const tursoUrl = (process.env.TURSO_DATABASE_URL ?? '').trim();
  const tursoToken = (process.env.TURSO_AUTH_TOKEN ?? '').trim();

  // Use Turso when configured, local SQLite otherwise
  if (tursoUrl) {
    const libsql = createClient({
      url: tursoUrl,
      authToken: tursoToken || undefined,
    });
    const adapter = new PrismaLibSQL(libsql);
    return new PrismaClient({ adapter });
  }

  // Local dev: plain SQLite via DATABASE_URL
  return new PrismaClient({ log: ['error'] });
}

export const prisma = globalForPrisma.prisma ?? buildPrisma();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
