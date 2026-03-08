// Email addresses are no longer stored in the database.
// Upload your CSV when creating a campaign via POST /api/campaigns.
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Emails are not stored. Upload a CSV with each campaign.' });
}
