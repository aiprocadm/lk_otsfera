import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/guard';
import { getSyncSummary } from '@/lib/services/syncSummary';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminCheck = requireAdmin(session);
  if (!adminCheck.ok) return adminCheck.response;

  const rows = await getSyncSummary(prisma);
  return NextResponse.json({ rows });
}
