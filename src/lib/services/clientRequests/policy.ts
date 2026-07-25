import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 5 (Модуль 1): RBAC заявок клиентов. Подают ТОЛЬКО клиентские роли
 * (партнёр/организация) — staff создают лиды напрямую (ФТ-1.6). Триаж —
 * наша сторона: менеджеры (включая leader) и админ.
 */
export function canSubmitClientRequest(session: SessionPayload): boolean {
  return session.role === 'partner' || session.role === 'organization';
}

export function canTriageClientRequests(session: SessionPayload): boolean {
  return session.role === 'manager' || session.role === 'admin';
}
