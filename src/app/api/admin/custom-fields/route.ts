import { NextResponse } from 'next/server';
import { requireFieldsAdmin, requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { createDefinition } from '@/lib/services/customFields';

function mapErr(e: string): number {
  if (e === 'forbidden') return 403;
  if (e === 'not_found') return 404;
  return 400;
}

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireFieldsAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const body = await req.json();
  const res = await createDefinition(prisma, adminGuard.value, {
    entityType: body.entityType,
    key: body.key,
    label: body.label,
    fieldType: body.fieldType,
    options: body.options,
    required: body.required,
    sortOrder: body.sortOrder,
    helpText: body.helpText,
    visibleToRoles: body.visibleToRoles,
    editableByRoles: body.editableByRoles
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapErr(res.error) });
  return NextResponse.json({ definition: res.definition }, { status: 201 });
}
