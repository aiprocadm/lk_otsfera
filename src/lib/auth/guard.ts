import { NextResponse } from 'next/server';
import { getSession } from './session';
import { canReadOrder } from './policy';
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
