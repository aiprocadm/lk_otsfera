import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const partner = requirePartner(session);
  if (!partner.ok) return partner.response;

  const { partnerId } = partner.value;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const skip = parseInt(url.searchParams.get('skip') ?? '0', 10);
  const take = Math.min(parseInt(url.searchParams.get('take') ?? '20', 10), 100);

  const [kpis, statements] = await Promise.all([
    getFinanceKpis(prisma, partnerId),
    listStatements(prisma, {
      partnerId,
      status,
      from: fromStr ? new Date(fromStr) : undefined,
      to: toStr ? new Date(toStr) : undefined,
      skip,
      take,
    }),
  ]);

  return NextResponse.json({ kpis, statements });
}
