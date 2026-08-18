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
  if (roles.includes(session.role)) return { ok: true, value: session };
  // Переходный мост программы «роль Руководитель» (ТЗ 2026-08-17, Р-Л-2/Р-Л-3):
  // руководитель исторически проходил всюду как manager, поэтому список с
  // 'manager' обязан пускать и роль 'leader' — иначе выделение роли молча
  // закрыло бы ему 14 API-списков до их разбора в PR-2. Места, где нужен
  // ИМЕННО рядовой менеджер, перечисляют роли без 'manager'-моста осознанно
  // (их разберёт PR-2); мост снимается PR-4.
  if (session.role === 'leader' && roles.includes('manager')) {
    return { ok: true, value: session };
  }
  return { ok: false, response: forbiddenResponse() };
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
 * руководитель. `isManagerLeader` понимает обе модели руководителя
 * (роль `leader` и переходную пару manager+managerRole — Р-Л-2 ТЗ 2026-08-17).
 * Обычный менеджер — 403.
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
