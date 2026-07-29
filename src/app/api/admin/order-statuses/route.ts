import { NextResponse } from 'next/server';
import { requireFieldsAdmin, requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { createStatusDefinition } from '@/lib/services/orderStatuses';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const guard = requireFieldsAdmin(sessionResult.value);
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const res = await createStatusDefinition(prisma, guard.value, {
    key: body.key,
    label: body.label,
    sortOrder: body.sortOrder,
    isTerminal: body.isTerminal
    // anchor намеренно не принимается из формы: якоря раздаёт система,
    // заказчик привязывать статус к событию не может (спека §4.1).
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ definition: res.definition }, { status: 201 });
}
