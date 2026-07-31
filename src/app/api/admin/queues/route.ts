import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { getQueueStats } from '@/lib/services/admin/queueStats';

export const GET = withAuth({ guard: requireAdmin }, async () => {
  const rows = await getQueueStats();
  return NextResponse.json({ rows });
});
