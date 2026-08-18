import { NextResponse } from 'next/server';
import { getSession } from './session';
import { isPartnerAdmin } from './policy';
import { isManagerLeader } from './managerPolicy';
import type { Role, SessionPayload } from './jwt';

type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response };

function unauthorizedResponse(message = 'Unauthorized') {
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
  // Мост «'manager' в списке пускает leader» снят PR-4 (ТЗ 2026-08-17):
  // каждый вызов перечисляет роли явно, включая 'leader' там, где проходит
  // весь менеджерский контур.
  if (!roles.includes(session.role)) return { ok: false, response: forbiddenResponse() };
  return { ok: true, value: session };
}

/*
 * `requireOrderAccess` (обёртка над canReadOrder, возвращавшая Response) удалён
 * аудитом A1: оба его вызова уехали в сервисный слой (comments/documents),
 * а там предикат `canReadOrder` вызывается напрямую и отдаёт код результата —
 * HTTP-ответ собирает роут. Экспорт «на всякий случай» ловит knip (§12b).
 */

export function requireAdmin(session: SessionPayload): GuardResult<SessionPayload> {
  if (session.role !== 'admin')
    return { ok: false, response: forbiddenResponse('Admin access only') };
  return { ok: true, value: session };
}

/**
 * §4 ТЗ v0.5, строка «Настройка полей и статусов»: администратор ИЛИ
 * руководитель (`isManagerLeader` — самостоятельная роль `leader`,
 * ТЗ 2026-08-17). Обычный менеджер — 403.
 */
export function requireFieldsAdmin(session: SessionPayload): GuardResult<SessionPayload> {
  if (session.role === 'admin') return { ok: true, value: session };
  if (isManagerLeader(session)) return { ok: true, value: session };
  return { ok: false, response: forbiddenResponse('Admin or leader access only') };
}

export function requirePartner(
  session: SessionPayload
): GuardResult<SessionPayload & { partnerId: string }> {
  if (session.role !== 'partner' || !session.partnerId) {
    return { ok: false, response: forbiddenResponse('Partner access only') };
  }
  return { ok: true, value: session as SessionPayload & { partnerId: string } };
}

export function requirePartnerAdmin(
  session: SessionPayload
): GuardResult<SessionPayload & { partnerId: string }> {
  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult;
  if (!isPartnerAdmin(session)) {
    return { ok: false, response: forbiddenResponse('Partner admin only') };
  }
  return partnerResult;
}
