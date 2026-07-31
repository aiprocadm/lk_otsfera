import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { listOrderItems, addOrderItem } from '@/lib/services/training/orderItems';

function mapError(error: string): number {
  switch (error) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'duplicate_position':
      return 409;
    default:
      return 400; // direction_inactive | student_mismatch | validation
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const res = await listOrderItems(prisma, session, { orderId: id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ items: res.items });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const body = (await req.json()) as { studentId: string; directionId: string; note?: string };
  const res = await addOrderItem(prisma, session, {
    orderId: id,
    studentId: body.studentId,
    directionId: body.directionId,
    note: body.note,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ item: res.item }, { status: 201 });
}
