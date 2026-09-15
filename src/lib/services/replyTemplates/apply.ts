import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { log } from '@/lib/logging';
import { applyPlaceholders, extractPlaceholders } from '@/lib/templates/placeholders';
import { isDialogInScope } from '@/lib/services/messengers/scope';
import { REPLY_TEMPLATE_TOKENS } from './crud';

/**
 * Вставка шаблона в форму ответа (`У-208`).
 *
 * Значения собираются по диалогу: контакт, организация, сам сотрудник и
 * последний заказ организации в работе. Чего нет — то остаётся **пустым** и
 * попадает в список предупреждений: сотрудник видит, что подставилось не всё,
 * ДО отправки. Молча оставлять `{{order.number}}` в тексте нельзя — клиент
 * получил бы письмо с фигурными скобками.
 */

export type ApplyTemplateResult =
  | {
      ok: true;
      text: string;
      /**
       * Подстановки, для которых значения не нашлось, — русскими названиями:
       * их показывают сотруднику до отправки. Машинные имена (`order.number`)
       * человеку ничего не говорят (§15).
       */
      empty: string[];
    }
  | { ok: false; error: 'forbidden' | 'not_found' };

/** Русское название подстановки — его и показываем человеку. */
const TOKEN_LABELS = new Map(REPLY_TEMPLATE_TOKENS.map((t) => [t.token as string, t.label]));

/**
 * Когда заказ считается «в работе» для подстановки номера. Завершённые и
 * отменённые не берём: клиенту пишут про то, что идёт сейчас.
 */
const ACTIVE_ORDER_STATUSES = ['pending', 'in_progress', 'on_hold'] as const;

export async function applyReplyTemplate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { templateId: string; dialogId: string }
): Promise<ApplyTemplateResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const [template, dialog] = await Promise.all([
    prisma.replyTemplate.findFirst({
      where: { id: args.templateId, companyId: session.companyId },
      select: { id: true, body: true },
    }),
    prisma.messengerDialog.findUnique({
      where: { id: args.dialogId },
      select: {
        id: true,
        companyId: true,
        peerDisplay: true,
        contact: { select: { name: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  if (!template) return { ok: false, error: 'not_found' };
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };

  // Лишних запросов не делаем: и имя сотрудника, и номер заказа читаются,
  // только если соответствующая подстановка есть в тексте.
  const tokens = new Set(extractPlaceholders(template.body));

  const me = tokens.has('manager.name')
    ? await prisma.user.findUnique({ where: { id: session.sub }, select: { name: true } })
    : null;

  let orderNumber = '';
  if (tokens.has('order.number') && dialog.organization) {
    const order = await prisma.order.findFirst({
      where: {
        organizationId: dialog.organization.id,
        executionStatus: { in: [...ACTIVE_ORDER_STATUSES] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { orderNumber: true },
    });
    orderNumber = order?.orderNumber ?? '';
  }

  const values = new Map<string, string>([
    ['contact.name', dialog.contact?.name?.trim() || dialog.peerDisplay?.trim() || ''],
    ['organization.name', dialog.organization?.name?.trim() || ''],
    ['manager.name', me?.name?.trim() || ''],
    ['order.number', orderNumber],
  ]);

  // Каждый токен ИЗ ТЕКСТА получает значение — пустое, если подставить нечем.
  // Иначе неизвестный токен (например, оставшийся от прежнего списка) уехал бы
  // клиенту как есть, фигурными скобками: движок не трогает то, чего нет в
  // карте.
  for (const token of tokens) {
    if (!values.has(token)) values.set(token, '');
  }

  const empty = [...tokens].filter((t) => !values.get(t)).map((t) => TOKEN_LABELS.get(t) ?? t);
  const text = applyPlaceholders(template.body, values);

  // Счётчик использований — best-effort: он нужен, чтобы находить шаблоны,
  // которыми никто не пользуется, и его сбой не должен мешать ответу клиенту.
  try {
    await prisma.replyTemplate.update({
      where: { id: template.id },
      data: { usageCount: { increment: 1 } },
    });
  } catch (error) {
    log.warn('[replyTemplates/apply] usage counter failed', {
      templateId: template.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, text, empty };
}
