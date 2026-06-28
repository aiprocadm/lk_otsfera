import { NextResponse } from 'next/server';
import type { TrainingStatus } from '@prisma/client';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { updateItemStatus, removeOrderItem } from '@/lib/services/training/orderItems';

function mapError(error: string): number {
  switch (error) {
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'duplicate_position': return 409;
    default: return 400; // direction_inactive | student_mismatch | validation
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const body = await req.json() as { trainingStatus: TrainingStatus };
  const res = await updateItemStatus(prisma, session, {
    itemId: id,
    trainingStatus: body.trainingStatus,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ item: res.item });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const res = await removeOrderItem(prisma, session, { itemId: id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ removed: true });
}
