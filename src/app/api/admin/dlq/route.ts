import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { getDlq } from '@/lib/services/admin/queueStats';

export const GET = withAuth({ guard: requireAdmin }, async () => {
  const rows = await getDlq();
  return NextResponse.json({ rows });
});
