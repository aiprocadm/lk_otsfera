import { NextResponse } from 'next/server';
import type { TrainingStatus } from '@prisma/client';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { updateItemStatus, removeOrderItem } from '@/lib/services/training/orderItems';

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

/** Схема — только ФОРМА тела; enum-значение статуса валидирует сервис. */
const patchBodySchema = z.object({
  trainingStatus: z.string(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const parsed = await parseJsonBody(req, patchBodySchema);
  if (!parsed.ok) return parsed.response;
  const res = await updateItemStatus(prisma, session, {
    itemId: id,
    // Допустимость значения статуса проверяет сервис — здесь только форма.
    trainingStatus: parsed.data.trainingStatus as TrainingStatus,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ item: res.item });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const { id } = await params;
  const res = await removeOrderItem(prisma, session, { itemId: id });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ removed: true });
}
