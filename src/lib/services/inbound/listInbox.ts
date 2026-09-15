import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { inboxScopeWhere } from '@/lib/services/inbound/scope';

/**
 * Company-scoped staff inbox query (Task 11a).
 *
 * C8 invariant: a manager sees their OWN company's bound inbound messages
 * PLUS the shared "unresolved" triage queue (companyId=null — not yet bound
 * to any company), and NEVER another company's bound messages. The scope
 * itself lives in `scope.ts` (`inboxScopeWhere`, E2) — the single source of
 * truth shared with the attachment route and archive/restore actions.
 */

export type InboxFilters = {
  channel?: string;
  status?: 'unresolved' | 'bound' | 'archived';
  orgId?: string;
  /**
   * `У-215`: показать одно письмо — по ссылке «Открыть во «Входящих»» из ленты
   * диалога. Скоуп остаётся поверх: чужое письмо по прямой ссылке не откроется,
   * список просто окажется пустым.
   */
  messageId?: string;
  page?: number;
  pageSize?: number;
};

export type InboxItem = {
  id: string;
  channel: string;
  senderRef: string;
  senderDisplay: string | null;
  subject: string | null;
  body: string;
  createdAt: Date;
  status: string;
  resolvedOrgId: string | null;
  scanStatus: string;
  attachmentName: string | null;
  /**
   * `У-215`: диалог, в котором это письмо стало репликой. `null` — письмо ещё
   * не свёрнуто в диалог (так бывает у старых писем до этапа мессенджеров и у
   * каналов, которых в диалогах нет).
   */
  dialogId: string | null;
};

export type InboxResult = { items: InboxItem[]; total: number };

const INBOX_SELECT = {
  id: true,
  channel: true,
  senderRef: true,
  senderDisplay: true,
  subject: true,
  body: true,
  createdAt: true,
  status: true,
  resolvedOrgId: true,
  scanStatus: true,
  attachmentName: true,
  // Обратная связь `InboundMessage.dialogMessage` — одиночная (у реплики
  // `inboundMessageId` уникален), поэтому это join одной строки, а не список.
  dialogMessage: { select: { dialogId: true } },
} satisfies Prisma.InboundMessageSelect;

export async function listInbox(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: InboxFilters = {}
): Promise<InboxResult> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  // C8: bound messages are visible ONLY within the manager's own company;
  // unresolved messages (companyId null) are the shared triage queue,
  // visible to all staff. See scope.ts for the sentinel rationale.
  const scope = inboxScopeWhere(session);

  const extra: Prisma.InboundMessageWhereInput = {};
  if (filters.channel) extra.channel = filters.channel;
  if (filters.status) extra.status = filters.status;
  if (filters.orgId) extra.resolvedOrgId = filters.orgId;
  if (filters.messageId) extra.id = filters.messageId;

  const where: Prisma.InboundMessageWhereInput = { AND: [scope, extra] };

  const [rows, total] = await Promise.all([
    prisma.inboundMessage.findMany({
      where,
      select: INBOX_SELECT,
      // Хвост `id` обязателен (хотфикс №25): письма разбираются пачкой за один
      // заход почтового обхода и получают общий `createdAt`.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inboundMessage.count({ where }),
  ]);

  await recordPiiAccess(prisma, {
    session,
    context: 'inbox_list',
    subjectIds: rows.map((r) => r.id),
  });

  // Разворачиваем join в плоское поле: компонент списка не должен знать, что
  // связь называется `dialogMessage` и что она односторонняя.
  const items = rows.map(({ dialogMessage, ...row }) => ({
    ...row,
    dialogId: dialogMessage?.dialogId ?? null,
  }));

  return { items, total };
}
