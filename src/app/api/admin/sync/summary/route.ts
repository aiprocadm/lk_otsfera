import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { getSyncSummary } from '@/lib/services/syncSummary';

export const GET = withAuth({ guard: requireAdmin }, async () => {
  const rows = await getSyncSummary(prisma);
  return NextResponse.json({ rows });
});
