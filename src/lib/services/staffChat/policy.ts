import type { StaffConversationKind } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';

/** C8-sentinel: companyId=null у staff-сессии режет выборку в ноль, а не «во всё» (паттерн chat/threads.ts). */
export const NO_COMPANY_SENTINEL = '__no_company__';

export type StaffConversationView = { kind: StaffConversationKind; companyId: string };

export function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

/**
 * M4 §2.2: admin — Model A (видит и участвует везде); dm — только участники;
 * general — только staff своей компании (companyId=null → deny).
 */
export function canSeeStaffConversation(
  session: SessionPayload,
  conversation: StaffConversationView,
  participantUserIds: string[]
): boolean {
  if (!isStaff(session)) return false;
  if (session.role === 'admin') return true;
  // Компании открыт только «# Общий»; личные и свои чаты (`group`, `У-315`)
  // видят лишь участники. Условие нарочно «не общий», а не «личный»: новый
  // вид беседы по умолчанию закрыт, а не открыт всей компании.
  if (conversation.kind !== 'general') return participantUserIds.includes(session.sub);
  return !!session.companyId && conversation.companyId === session.companyId;
}
