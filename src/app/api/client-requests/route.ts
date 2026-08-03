import { NextResponse } from 'next/server';
import { ClientRequestStatus } from '@prisma/client';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitClientRequest } from '@/lib/services/clientRequests/submit';
import { listClientRequests } from '@/lib/services/clientRequests/list';

// Дедупликация C2: источник — prisma-enum ClientRequestStatus (schema.prisma).
const STATUSES: string[] = Object.values(ClientRequestStatus);

/** Тонкие роуты заявок клиентов (этап 5): только маппинг кодов в HTTP (§3). */
export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Схема — только «тело — JSON-объект»: не-строки → null (str) остаётся
  // обязанностью роута (закреплено тестом), валидацию полей делает сервис.
  const parsed = await parseJsonBody(req, z.record(z.unknown()));
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const res = await submitClientRequest(prisma, session, {
    companyName: str(body.companyName),
    inn: str(body.inn),
    contactName: str(body.contactName),
    contactPhone: str(body.contactPhone),
    contactEmail: str(body.contactEmail),
    subject: str(body.subject),
    body: str(body.body),
    organizationId: str(body.organizationId),
  });
  if (!res.ok) {
    const status = res.error === 'validation' ? 400 : 403;
    return NextResponse.json({ error: res.error, messages: res.messages ?? [] }, { status });
  }
  return NextResponse.json({ id: res.request.id }, { status: 201 });
}

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const statusRaw = sp.get('status');
  const status =
    statusRaw && STATUSES.includes(statusRaw) ? (statusRaw as ClientRequestStatus) : undefined;
  const result = await listClientRequests(prisma, session, {
    status,
    cursor: sp.get('cursor') ?? undefined,
  });
  return NextResponse.json(result);
}
