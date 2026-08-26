import type { PrismaClient } from '@prisma/client';
import type { EmailTemplateKey } from '@/lib/notifications/channels/types';
import { log } from '@/lib/logging';
import { EMAIL_TEMPLATE_REGISTRY, renderTemplateText } from './templateRegistry';

/**
 * Свои тексты писем поверх встроенных (`У-128`).
 *
 * Приоритет тот же, что у правил (`У-127`): **компания → платформа → код**.
 * Отсутствие записи означает «письмо собирает программа, как раньше», поэтому
 * механизм сам по себе ничего не меняет.
 *
 * **Из переопределения берутся только тема и текст.** Вёрстка — шапка, кнопка,
 * подвал — по-прежнему за `layout.tsx`: иначе первое же отредактированное
 * письмо потеряло бы фирменный вид и выглядело бы как спам.
 */

export type TemplateOverride = { subject: string; body: string };

/**
 * Действующий текст письма, если он переопределён.
 *
 * Сбой чтения не роняет отправку: письмо уйдёт встроенным шаблоном. Направление
 * отказа то же, что у правил, — **отправить**, а не промолчать.
 */
export async function getTemplateOverride(
  prisma: PrismaClient,
  key: EmailTemplateKey,
  companyId?: string | null
): Promise<TemplateOverride | null> {
  try {
    const rows = await prisma.notificationTemplate.findMany({
      where: {
        templateKey: key,
        OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])],
      },
      select: { companyId: true, subject: true, body: true },
    });
    if (rows.length === 0) return null;
    // Компания перекрывает платформу.
    const own = rows.find((r) => r.companyId !== null);
    const platform = rows.find((r) => r.companyId === null);
    const hit = own ?? platform;
    if (!hit) return null;
    if (hit.subject.trim() === '' && hit.body.trim() === '') return null;
    return { subject: hit.subject, body: hit.body };
  } catch (err) {
    log.warn('[email] свой текст письма недоступен — отправляем встроенным', {
      template: key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Готовые тема и текст: подстановки заменены значениями письма. */
export function applyOverride(
  key: EmailTemplateKey,
  override: TemplateOverride,
  props: Record<string, unknown>
): { subject: string; text: string } {
  return {
    subject: renderTemplateText(key, override.subject, props),
    text: renderTemplateText(key, override.body, props),
  };
}

export type TemplateRow = {
  key: EmailTemplateKey;
  label: string;
  subject: string;
  body: string;
  /** Откуда взялся текст — чтобы человек видел, что он перекрыл. */
  source: 'company' | 'platform' | 'default';
};

/** Полный список писем для экрана: свои тексты поверх встроенных. */
export async function listTemplates(
  prisma: PrismaClient,
  companyId?: string | null
): Promise<TemplateRow[]> {
  let stored: Array<{
    companyId: string | null;
    templateKey: string;
    subject: string;
    body: string;
  }> = [];
  try {
    stored = await prisma.notificationTemplate.findMany({
      where: { OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      select: { companyId: true, templateKey: true, subject: true, body: true },
    });
  } catch (err) {
    log.warn('[email] свои тексты недоступны — показываем встроенные', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return (Object.keys(EMAIL_TEMPLATE_REGISTRY) as EmailTemplateKey[]).map((key) => {
    const own = companyId
      ? stored.find((r) => r.templateKey === key && r.companyId !== null)
      : undefined;
    const platform = stored.find((r) => r.templateKey === key && r.companyId === null);
    const hit = own ?? platform;
    return {
      key,
      label: EMAIL_TEMPLATE_REGISTRY[key].label,
      subject: hit?.subject ?? '',
      body: hit?.body ?? '',
      source: own ? 'company' : platform ? 'platform' : 'default',
    };
  });
}
