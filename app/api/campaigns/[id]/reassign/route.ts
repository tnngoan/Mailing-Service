import { NextRequest, NextResponse } from 'next/server';
import { reassignProviderEmails } from '@/lib/providers';

// POST /api/campaigns/:id/reassign — move pending emails from a broken provider to others
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await req.json();
    const fromProvider = body.fromProvider;
    if (!fromProvider || typeof fromProvider !== 'string') {
      return NextResponse.json({ error: 'fromProvider is required' }, { status: 400 });
    }

    const result = await reassignProviderEmails(id, fromProvider);

    if (result.reassigned === 0) {
      return NextResponse.json({ message: 'No pending emails to reassign', reassigned: 0 });
    }

    return NextResponse.json({
      message: `Reassigned ${result.reassigned} emails from ${fromProvider}`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/campaigns/[id]/reassign]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
