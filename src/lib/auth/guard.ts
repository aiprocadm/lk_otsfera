import { NextResponse } from 'next/server';
import { getSession } from './session';
import { canReadOrder, isPartnerAdmin } from './policy';
import type { Role, SessionPayload } from './jwt';

type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response };

export function unauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function requireSession(): Promise<GuardResult<SessionPayload>> {
  const session = await getSession();
  if (!session) return { ok: false, response: unauthorizedResponse() };
  return { ok: true, value: session };
}

export function requireRole(session: SessionPayload, roles: Role[]): GuardResult<SessionPayload> {
  if (!roles.includes(session.role)) return { ok: false, response: forbiddenResponse() };
  return { ok: true, value: session };
}

export async function requireOrderAccess(session: SessionPayload, order: { id: string; companyId: string }): Promise<GuardResult<SessionPayload>> {
  const canRead = await canReadOrder(session, order);
  if (!canRead) return { ok: false, response: forbiddenResponse() };
  return { ok: true, value: session };
}

export function requireAdmin(session: SessionPayload): GuardResult<SessionPayload> {
  if (session.role !== 'admin') return { ok: false, response: forbiddenResponse('Admin access only') };
  return { ok: true, value: session };
}

/**
 * §4 ТЗ v0.5, строка «Настройка полей и статусов»: администратор ИЛИ
 * руководитель. Руководитель — суб-роль менеджера (`managerRole='leader'`),
 * а не top-level Role, поэтому обычной проверки роли мало. Обычный менеджер — 403.
 */
export function requireFieldsAdmin(session: SessionPayload): GuardResult<SessionPayload> {
  if (session.role === 'admin') return { ok: true, value: session };
  if (session.role === 'manager' && session.managerRole === 'leader') {
    return { ok: true, value: session };
  }
  return { ok: false, response: forbiddenResponse('Admin or leader access only') };
}

export function requirePartner(session: SessionPayload): GuardResult<SessionPayload & { partnerId: string }> {
  if (session.role !== 'partner' || !session.partnerId) {
    return { ok: false, response: forbiddenResponse('Partner access only') };
  }
  return { ok: true, value: session as SessionPayload & { partnerId: string } };
}

export function requirePartnerAdmin(session: SessionPayload): GuardResult<SessionPayload & { partnerId: string }> {
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult;
  if (!isPartnerAdmin(session)) {
    return { ok: false, response: forbiddenResponse('Partner admin only') };
  }
  return partnerResult;
}
