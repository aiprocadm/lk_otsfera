import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canReadOrder } from '@/lib/auth/policy';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orders = await prisma.order.findMany();
  const visibleOrders = [];
  for (const order of orders) {
    if (await canReadOrder(s, order)) visibleOrders.push(order);
  }

  return NextResponse.json(visibleOrders);
}
