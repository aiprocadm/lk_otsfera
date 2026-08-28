'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import {
  EMAIL_TEMPLATE_REGISTRY,
  isEmailTemplateKey,
  renderTemplateText,
  validateTemplateText,
} from '@/lib/email/templateRegistry';
import { sendNotificationEmail } from '@/lib/email/send';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Свои тексты писем (`У-128`).
 *
 * Область правки задаёт **роль**, а не форма: администратор пишет тексты
 * платформы, руководитель — своей компании. Компания берётся из сессии.
 */

export type SaveTemplateResult =
  | { ok: true }
  | {
      ok: false;
      error: 'validation' | 'company_required' | 'unknown_placeholder';
      unknown?: string[];
    };

export type ResetTemplateResult =
  { ok: true } | { ok: false; error: 'validation' | 'company_required' };

export type TestTemplateResult =
  { ok: true; skipped: boolean } | { ok: false; error: 'send_failed' };

function pathFor(cabinet: SettingsCabinet): string {
  return `/${cabinet}/settings/catalogs/email-templates`;
}

function scopeOf(
  cabinet: SettingsCabinet,
  session: { companyId?: string | null }
): { ok: true; companyId: string | null } | { ok: false } {
  if (cabinet === 'admin') return { ok: true, companyId: null };
  const companyId = session.companyId ?? null;
  // Пустая область означала бы «правлю платформу» — тихое повышение прав.
  if (!companyId) return { ok: false };
  return { ok: true, companyId };
}

/**
 * Тестовые данные для предпросмотра и пробного письма.
 *
 * Значения нарочно узнаваемые: увидев в письме «ООО «Ромашка»», человек
 * понимает, что это подстановка, а не настоящий клиент.
 */
/*
 * НЕ экспортируется намеренно: в файле с `'use server'` каждый экспорт обязан
 * быть async-функцией (Next.js делает из него серверное действие). Синхронный
 * экспорт роняет production-сборку — `npm run build` падает с «Server Actions
 * must be async functions», хотя typecheck, lint и тесты остаются зелёными.
 * Функция нужна только внутри этого файла (§12b: без `export`).
 */
function sampleProps(key: string): Record<string, string> {
  const spec = isEmailTemplateKey(key) ? EMAIL_TEMPLATE_REGISTRY[key] : null;
  const values: Record<string, string> = {
    orderNumber: 'З-2026-001',
    orderTitle: 'Обучение по охране труда',
    orderUrl: 'https://lk.example/orders/demo',
    organizationName: 'ООО «Ромашка»',
    partnerName: 'ООО «Партнёр»',
    documentName: 'Акт №12.pdf',
    documentType: 'Акт',
    amount: '48 500,00 ₽',
    paidAt: '26.08.2026',
    commentBody: 'Подскажите, когда будут документы?',
    managerName: 'Иванов Иван',
    actorName: 'Иванов Иван',
    oldStatus: 'В работе',
    newStatus: 'Завершён',
    title: 'Заголовок уведомления',
    body: 'Текст уведомления',
    url: 'https://lk.example/dashboard',
    recipientName: 'Пётр',
    periodFrom: '01.08.2026',
    periodTo: '31.08.2026',
    statementUrl: 'https://lk.example/partner/finance',
  };
  const out: Record<string, string> = {};
  for (const p of spec?.placeholders ?? []) out[p.prop] = values[p.prop] ?? '—';
  return out;
}

/** Предпросмотр на тестовых данных — тем же кодом, что и настоящая отправка. */
export async function previewTemplateAction(
  cabinet: SettingsCabinet,
  key: string,
  subject: string,
  body: string
): Promise<
  { ok: true; subject: string; body: string } | { ok: false; error: string; unknown?: string[] }
> {
  await requireSettingsSection('catalogs.emailTemplates', cabinet);
  if (!isEmailTemplateKey(key)) return { ok: false, error: 'validation' };

  const check = validateTemplateText(key, subject, body);
  if (!check.ok) return { ok: false, error: 'unknown_placeholder', unknown: check.unknown };

  const props = sampleProps(key);
  return {
    ok: true,
    subject: renderTemplateText(key, subject, props),
    body: renderTemplateText(key, body, props),
  };
}

export async function saveTemplateAction(
  cabinet: SettingsCabinet,
  key: string,
  subject: string,
  body: string
): Promise<SaveTemplateResult> {
  const session = await requireSettingsSection('catalogs.emailTemplates', cabinet);
  if (!isEmailTemplateKey(key)) return { ok: false, error: 'validation' };

  // Пустые тема и текст — это «вернуть стандартный», а не «письмо без темы».
  if (subject.trim() === '' && body.trim() === '') {
    return resetTemplateAction(cabinet, key);
  }
  if (subject.trim() === '' || body.trim() === '') return { ok: false, error: 'validation' };

  // `У-128`: неизвестная подстановка — отказ сохранить, а не дыра в письме.
  const check = validateTemplateText(key, subject, body);
  if (!check.ok) return { ok: false, error: 'unknown_placeholder', unknown: check.unknown };

  const scope = scopeOf(cabinet, session);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  // «Найти и обновить»: у платформенных шаблонов `companyId` равен NULL, а в
  // Postgres два NULL не равны — составной уникальный ключ их не различает.
  const existing = await prisma.notificationTemplate.findFirst({
    where: { companyId: scope.companyId, templateKey: key },
    select: { id: true },
  });
  if (existing) {
    await prisma.notificationTemplate.update({
      where: { id: existing.id },
      data: { subject, body, updatedBy: session.sub },
    });
  } else {
    await prisma.notificationTemplate.create({
      data: { companyId: scope.companyId, templateKey: key, subject, body, updatedBy: session.sub },
    });
  }

  await recordAudit(prisma, {
    action: 'email_template_changed',
    entity: 'email_template',
    entityId: key,
    userId: session.sub,
    // Текст письма в журнал не пишем: он может содержать данные клиента.
    after: { companyId: scope.companyId },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true };
}

/**
 * «Вернуть стандартный» — **удаляет** свой текст, а не записывает в него копию
 * встроенного. Копия заморозила бы письмо: вёрстка и формулировки менялись бы
 * в коде, а у компании оставался бы старый текст.
 */
export async function resetTemplateAction(
  cabinet: SettingsCabinet,
  key: string
): Promise<ResetTemplateResult> {
  const session = await requireSettingsSection('catalogs.emailTemplates', cabinet);
  if (!isEmailTemplateKey(key)) return { ok: false, error: 'validation' };

  const scope = scopeOf(cabinet, session);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  await prisma.notificationTemplate.deleteMany({
    where: { companyId: scope.companyId, templateKey: key },
  });
  await recordAudit(prisma, {
    action: 'email_template_reset',
    entity: 'email_template',
    entityId: key,
    userId: session.sub,
    after: { companyId: scope.companyId },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true };
}

/**
 * Пробное письмо **себе** (`У-128`).
 *
 * Уходит на адрес из сессии и никуда больше: возможность отправить пробное
 * письмо на произвольный адрес превратила бы настройки в рассыльщик.
 */
export async function sendTestTemplateAction(
  cabinet: SettingsCabinet,
  key: string,
  subject: string,
  body: string
): Promise<TestTemplateResult> {
  const session = await requireSettingsSection('catalogs.emailTemplates', cabinet);
  if (!isEmailTemplateKey(key)) return { ok: false, error: 'send_failed' };

  const check = validateTemplateText(key, subject, body);
  if (!check.ok) return { ok: false, error: 'send_failed' };

  // Адрес берётся из сессии и только оттуда. Сессия без адреса — не ошибка
  // отправки, а «слать некуда»: сообщаем честно, а не притворяемся, что ушло.
  const to = session.email?.trim();
  if (!to) return { ok: true, skipped: true };

  const props = sampleProps(key);
  try {
    const res = await sendNotificationEmail({
      to,
      recipientName: 'коллега',
      // Пометка в теме: письмо приходит с настоящими данными-образцами, и без
      // неё его можно принять за настоящее.
      title: `[проверка] ${renderTemplateText(key, subject, props)}`,
      body: renderTemplateText(key, body, props),
    });
    await recordAudit(prisma, {
      action: 'email_template_test_sent',
      entity: 'email_template',
      entityId: key,
      userId: session.sub,
    });
    return { ok: true, skipped: res.status !== 'sent' };
  } catch (err) {
    log.error('[email-templates] пробное письмо не ушло', {
      template: key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'send_failed' };
  }
}
