import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { getQueueStats } from '@/lib/services/admin/queueStats';

export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const rows = await getQueueStats();
  return NextResponse.json({ rows });
}
