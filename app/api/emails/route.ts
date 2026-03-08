import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseEmailsFromCSV } from '@/lib/csv-parser';

// GET /api/emails — return total email count
export async function GET() {
  const count = await prisma.email.count();
  return NextResponse.json({ count });
}

// POST /api/emails — upload CSV and insert unique emails
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const text = await file.text();
    const emails = parseEmailsFromCSV(text);

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'No valid email addresses found in file' },
        { status: 400 }
      );
    }

    // INSERT OR IGNORE for SQLite-compatible duplicate skipping.
    // Chunks of 500 stay well within SQLite's 999-parameter limit.
    // Pass createdAt as a JS Date string rather than datetime('now') to
    // keep it consistent with how Prisma stores DateTime in SQLite.
    const CHUNK = 500;
    let inserted = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = emails.slice(i, i + CHUNK);
      const countBefore = await prisma.email.count();
      const rows = chunk.map(() => `(?, ?)`).join(', ');
      const params: string[] = [];
      chunk.forEach((email) => params.push(email, now));
      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "Email" ("email", "createdAt") VALUES ${rows}`,
        ...params
      );
      const countAfter = await prisma.email.count();
      inserted += countAfter - countBefore;
    }

    const total = await prisma.email.count();

    return NextResponse.json({
      parsed: emails.length,
      inserted,
      duplicatesSkipped: emails.length - inserted,
      total,
    });
  } catch (err) {
    console.error('[POST /api/emails]', err);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}
