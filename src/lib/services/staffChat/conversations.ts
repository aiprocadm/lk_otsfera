import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaff, canSeeStaffConversation, NO_COMPANY_SENTINEL } from './policy';

export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export type EnsureGeneralResult = { ok: true; conversationId: string } | { ok: false; error: 'storage' };

/** Лениво создаёт «# Общий» компании; гонка гасится партиальным unique (P2002 → findFirst). */
export async function ensureGeneral(prisma: PrismaClient, companyId: string): Promise<EnsureGeneralResult> {
  const existing = await prisma.staffConversation.findFirst({
    where: { companyId, kind: 'general' },
    select: { id: true }
  });
  if (existing) return { ok: true, conversationId: existing.id };
  try {
    const created = await prisma.staffConversation.create({
      data: { companyId, kind: 'general' },
      select: { id: true }
    });
    return { ok: true, conversationId: created.id };
  } catch {
    const raced = await prisma.staffConversation.findFirst({
      where: { companyId, kind: 'general' },
      select: { id: true }
    });
    return raced ? { ok: true, conversationId: raced.id } : { ok: false, error: 'storage' };
  }
}

export type OpenDmResult = { ok: true; conversationId: string } | { ok: false; error: 'forbidden' | 'target_not_found' };

export async function openDm(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { targetUserId: string }
): Promise<OpenDmResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  if (args.targetUserId === session.sub) return { ok: false, error: 'forbidden' };
  const target = await prisma.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true, role: true, companyId: true, isActive: true }
  });
  if (!target || !target.isActive) return { ok: false, error: 'target_not_found' };
  const targetStaff = target.role === 'admin' || target.role === 'manager';
  if (!targetStaff) return { ok: false, error: 'forbidden' };
  // C8: DM staff↔staff — внутри одной компании; admin (Model A) может писать любому.
  // companyId беседы = компания не-админ участника (admin.companyId может быть null).
  if (session.role !== 'admin' && target.role !== 'admin') {
    if (!session.companyId || session.companyId !== target.companyId) return { ok: false, error: 'forbidden' };
  }
  const companyId =
    (session.role === 'admin' ? target.companyId : target.role === 'admin' ? session.companyId : session.companyId) ??
    session.companyId ??
    target.companyId;
  if (!companyId) return { ok: false, error: 'forbidden' }; // оба без компании — ЛС некуда прикрепить
  const key = dmKeyFor(session.sub, args.targetUserId);
  try {
    const created = await prisma.staffConversation.create({
      data: {
        companyId,
        kind: 'dm',
        dmKey: key,
        participants: { create: [{ userId: session.sub }, { userId: args.targetUserId }] }
      },
      select: { id: true }
    });
    return { ok: true, conversationId: created.id };
  } catch {
    const existing = await prisma.staffConversation.findUnique({ where: { dmKey: key }, select: { id: true } });
    return existing ? { ok: true, conversationId: existing.id } : { ok: false, error: 'forbidden' };
  }
}

export type StaffConversationRow = {
  id: string;
  kind: 'dm' | 'general';
  title: string;
  companyName: string | null; // admin с несколькими компаниями различает general-каналы
  lastMessageAt: Date;
  unread: boolean;
};
export type ListConversationsResult = { ok: true; rows: StaffConversationRow[] };

/**
 * general(и) + СВОИ dm. Admin: general всех компаний (Model A), dm — только собственные
 * (oversight чужих ЛС остаётся возможен по id через canSee, но инбокс не засоряем).
 */
export async function listConversations(prisma: PrismaClient, session: SessionPayload): Promise<ListConversationsResult> {
  if (!isStaff(session)) return { ok: true, rows: [] };
  if (session.role === 'manager' && session.companyId) {
    await ensureGeneral(prisma, session.companyId); // лениво, идемпотентно
  }
  const where =
    session.role === 'admin'
      ? { OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }] }
      : {
          companyId: session.companyId ?? NO_COMPANY_SENTINEL,
          OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }]
        };
  const rows = await prisma.staffConversation.findMany({
    where,
    select: {
      id: true,
      kind: true,
      lastMessageAt: true,
      company: { select: { name: true } },
      participants: { select: { userId: true, user: { select: { name: true } } } },
      readStates: { where: { userId: session.sub }, select: { lastReadAt: true }, take: 1 }
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100
  });
  return {
    ok: true,
    rows: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      title:
        c.kind === 'general'
          ? '# Общий'
          : (c.participants.find((p) => p.userId !== session.sub)?.user.name ?? 'Диалог'),
      companyName: c.kind === 'general' ? c.company.name : null,
      lastMessageAt: c.lastMessageAt,
      unread: c.lastMessageAt > (c.readStates[0]?.lastReadAt ?? new Date(0))
    }))
  };
}

export type StaffUnreadResult = { ok: true; count: number };

/** Кол-во бесед с непрочитанным (зеркало chat/unreadCount, но на Prisma — объёмы staff-чата малы). */
export async function staffUnreadCount(prisma: PrismaClient, session: SessionPayload): Promise<StaffUnreadResult> {
  if (!isStaff(session)) return { ok: true, count: 0 };
  const where =
    session.role === 'admin'
      ? { OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }] }
      : {
          companyId: session.companyId ?? NO_COMPANY_SENTINEL,
          OR: [{ kind: 'general' as const }, { participants: { some: { userId: session.sub } } }]
        };
  const rows = await prisma.staffConversation.findMany({
    where,
    select: { lastMessageAt: true, readStates: { where: { userId: session.sub }, select: { lastReadAt: true }, take: 1 } },
    take: 200
  });
  const count = rows.filter((c) => c.lastMessageAt > (c.readStates[0]?.lastReadAt ?? new Date(0))).length;
  return { ok: true, count };
}

export type MarkStaffReadResult = { ok: true } | { ok: false; error: 'forbidden' | 'conversation_not_found' };

export async function markStaffRead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { conversationId: string }
): Promise<MarkStaffReadResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const conv = await prisma.staffConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } }
  });
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (!canSeeStaffConversation(session, conv, conv.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }
  await prisma.staffMessageRead.upsert({
    where: { conversationId_userId: { conversationId: conv.id, userId: session.sub } },
    update: { lastReadAt: new Date() },
    create: { conversationId: conv.id, userId: session.sub }
  });
  return { ok: true };
}
