import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { forbiddenResponse } from '@/lib/auth/policy';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'student') return forbiddenResponse('Students do not have dashboard access');

  return NextResponse.json({ ok: true });
}
