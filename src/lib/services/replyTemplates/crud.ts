import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import type { SessionPayload } from '@/lib/auth/jwt';
import { findUnknownPlaceholders } from '@/lib/templates/placeholders';
import { DIALOG_CHANNELS, type DialogChannel } from '@/lib/services/messengers/channels';

/**
 * Шаблоны быстрых ответов (`У-208`, спека этапа 3 §3.4 плана).
 *
 * Зачем они: менеджер отвечает на одни и те же вопросы десятки раз в день, и
 * каждый набирает ответ заново — с разной формулировкой и разными опечатками.
 * Шаблон даёт заготовку, которую перед отправкой можно поправить.
 *
 * Подстановки — общий движок `lib/templates/placeholders` (тот же, что у писем
 * и договоров). Неизвестная подстановка — **отказ сохранить**, а не дыра в
 * готовом тексте: «Здравствуйте, {{contact.nmae}}» ушло бы клиенту как есть.
 */

/**
 * Что можно подставить в шаблон. Список закрытый — неизвестная подстановка
 * отказывает в сохранении.
 *
 * Телефона менеджера здесь НЕТ: у сотрудника в модели нет такого поля, и
 * подстановка всегда оставалась бы пустой. Обещать её в списке и подставлять
 * пустоту — хуже, чем не обещать вовсе (вопрос заказчику `В-3-11`: заводить
 * ли телефон сотруднику).
 */
export const REPLY_TEMPLATE_TOKENS = [
  { token: 'contact.name', label: 'Имя контакта' },
  { token: 'organization.name', label: 'Название организации' },
  { token: 'manager.name', label: 'Имя менеджера' },
  { token: 'order.number', label: 'Номер последнего заказа в работе' },
] as const;

const ALLOWED_TOKENS = REPLY_TEMPLATE_TOKENS.map((t) => t.token);

const TITLE_MAX = 120;
const BODY_MAX = 4000;

export type ReplyTemplateRow = {
  id: string;
  title: string;
  body: string;
  channels: DialogChannel[];
  isActive: boolean;
  sortOrder: number;
  usageCount: number;
};

export type SaveReplyTemplateArgs = {
  /** null — создаём новый. */
  id: string | null;
  title: string;
  body: string;
  channels: string[];
  isActive: boolean;
  sortOrder: number;
};

export type SaveReplyTemplateResult =
  | { ok: true; id: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'text_too_long' }
  | { ok: false; error: 'unknown_placeholder'; unknown: string[] };

/**
 * Список шаблонов компании. Порядок — как задал человек, затем по названию:
 * два шаблона с одинаковым весом не должны прыгать местами между запросами.
 */
export async function listReplyTemplates(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ReplyTemplateRow[]> {
  if (!session.companyId) return [];
  const rows = await prisma.replyTemplate.findMany({
    where: { companyId: session.companyId },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      body: true,
      channels: true,
      isActive: true,
      sortOrder: true,
      usageCount: true,
    },
  });
  return rows.map((r) => ({ ...r, channels: r.channels as DialogChannel[] }));
}

/** Шаблоны, которые предлагаются в конкретном канале (`У-208`). */
export async function listTemplatesForChannel(
  prisma: PrismaClient,
  session: SessionPayload,
  channel: DialogChannel
): Promise<ReplyTemplateRow[]> {
  const all = await listReplyTemplates(prisma, session);
  // Пустой список каналов у шаблона означает «любой канал» — так его и
  // заводят по умолчанию, и это самый частый случай.
  return all.filter((t) => t.isActive && (t.channels.length === 0 || t.channels.includes(channel)));
}

/**
 * Создание и правка шаблона. Доступ — только своя компания; чужой шаблон
 * отвечает `not_found`, а не `forbidden`: существование чужих шаблонов не
 * раскрываем.
 */
export async function saveReplyTemplate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: SaveReplyTemplateArgs
): Promise<SaveReplyTemplateResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const title = args.title.trim();
  const body = args.body.trim();
  if (!title || !body) return { ok: false, error: 'invalid' };
  if (title.length > TITLE_MAX || body.length > BODY_MAX) {
    return { ok: false, error: 'text_too_long' };
  }

  const check = findUnknownPlaceholders(ALLOWED_TOKENS, body);
  if (!check.ok) return { ok: false, error: 'unknown_placeholder', unknown: check.unknown };

  // Незнакомый канал молча не сохраняем: шаблон с опечаткой в канале не
  // предложился бы нигде, и человек искал бы причину глазами.
  const channels = args.channels.filter((c): c is DialogChannel =>
    (DIALOG_CHANNELS as readonly string[]).includes(c)
  );
  if (channels.length !== args.channels.length) return { ok: false, error: 'invalid' };

  if (args.id) {
    const existing = await prisma.replyTemplate.findFirst({
      where: { id: args.id, companyId: session.companyId },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: 'not_found' };

    await prisma.replyTemplate.update({
      where: { id: existing.id },
      data: {
        title,
        body,
        channels,
        isActive: args.isActive,
        sortOrder: args.sortOrder,
        updatedById: session.sub,
      },
    });
    await recordAudit(prisma, {
      action: 'reply_template_updated',
      entity: 'reply_template',
      entityId: existing.id,
      userId: session.sub,
      after: { title, isActive: args.isActive },
    });
    return { ok: true, id: existing.id };
  }

  const created = await prisma.replyTemplate.create({
    data: {
      companyId: session.companyId,
      title,
      body,
      channels,
      isActive: args.isActive,
      sortOrder: args.sortOrder,
      updatedById: session.sub,
    },
    select: { id: true },
  });
  await recordAudit(prisma, {
    action: 'reply_template_created',
    entity: 'reply_template',
    entityId: created.id,
    userId: session.sub,
    after: { title },
  });
  return { ok: true, id: created.id };
}

export type DeleteReplyTemplateResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Удаление шаблона. Насовсем: у шаблона нет истории, восстанавливать нечего,
 * а «спрятать на время» умеет переключатель «в работе».
 */
export async function deleteReplyTemplate(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<DeleteReplyTemplateResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const existing = await prisma.replyTemplate.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, title: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };

  await prisma.replyTemplate.delete({ where: { id: existing.id } });
  await recordAudit(prisma, {
    action: 'reply_template_deleted',
    entity: 'reply_template',
    entityId: existing.id,
    userId: session.sub,
    after: { title: existing.title },
  });
  return { ok: true };
}
