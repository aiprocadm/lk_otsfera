import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getClientRequest } from '@/lib/services/clientRequests/list';
import {
  takeInTriage,
  convertToLead,
  rejectClientRequest,
} from '@/lib/services/clientRequests/triage';

type Params = { params: Promise<{ id: string }> };

const statusFor = (
  error: 'forbidden' | 'not_found' | 'lifecycle_violation' | 'validation'
): number =>
  error === 'validation' ? 400 : error === 'forbidden' ? 403 : error === 'not_found' ? 404 : 409;

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const res = await getClientRequest(prisma, session, id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ request: res.request });
}

/** Триаж (ФТ-1.4): takeInTriage | convertToLead | reject — тонкий маппинг (§3). */
export async function PATCH(req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // Схема — только «тело — JSON-объект»: проверку action и String()-коэрцию
  // reason роут сохраняет; коды triage-сервисов не подменяются.
  const parsed = await parseJsonBody(req, z.record(z.unknown()));
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const action = body.action;

  if (action === 'takeInTriage') {
    const r = await takeInTriage(prisma, session, { id });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request });
  }
  if (action === 'convertToLead') {
    const r = await convertToLead(prisma, session, { id });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request, leadId: r.lead.id });
  }
  if (action === 'reject') {
    const r = await rejectClientRequest(prisma, session, {
      id,
      reason: String(body.reason ?? ''),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request });
  }
  return NextResponse.json(
    { error: 'Invalid action. Use takeInTriage|convertToLead|reject' },
    { status: 400 }
  );
}
