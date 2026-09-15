'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { recordAudit } from '@/lib/auth/audit';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { saveSettings } from '@/lib/config/integrationSettings';
import { prisma } from '@/lib/db/prisma';
import { MAX_ALLOWED_ORIGINS, parseAllowedOrigins } from '@/lib/services/clientRequests/website';

/**
 * Настройки раздела «Сайт» (`У-211`).
 *
 * Токен формы **показывается ровно один раз** — в ответе на выпуск. Дальше в
 * форме видно только «задан»: хранилище секретов наружу значений не отдаёт
 * никогда, и ломать это правило ради удобства нельзя. Забыл — выпусти новый,
 * прежний перестанет работать.
 */

type Validation = { ok: false; error: 'validation' };

const SettingsSchema = z.object({
  enabled: z.boolean(),
  allowedOrigins: z.string().max(2000),
  defaultManagerId: z.string().max(64),
});

export type SaveWebsiteSettingsResult =
  { ok: true } | { ok: false; error: 'too_many_origins' | 'unknown_manager' | 'save_failed' };

export async function saveWebsiteSettingsAction(input: {
  enabled: boolean;
  allowedOrigins: string;
  defaultManagerId: string;
}): Promise<SaveWebsiteSettingsResult | Validation> {
  // Гард ПЕРВЫМ, до разбора формы (§4): иначе посторонний по кривому вводу
  // узнаёт, что действие вообще существует и как отвечает.
  const session = await requireSettingsSection('integrations.website', 'admin');

  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  // Считаем ДО обрезки: молча выбросить лишние домены — значит оставить
  // человека в уверенности, что он их добавил.
  const raw = parsed.data.allowedOrigins.split(/[\s,;]+/).filter(Boolean);
  if (raw.length > MAX_ALLOWED_ORIGINS) return { ok: false, error: 'too_many_origins' };

  // Проверяем, что названный человек существует и состоит в контуре ЦО:
  // иначе настройка молча указывала бы в пустоту, а заявки уходили бы всем.
  const managerId = parsed.data.defaultManagerId.trim();
  if (managerId) {
    const manager = await prisma.user.findFirst({
      where: { id: managerId, role: { in: ['manager', 'leader'] }, isActive: true },
      select: { id: true },
    });
    if (!manager) return { ok: false, error: 'unknown_manager' };
  }
  const result = await saveSettings(prisma, session.sub, [
    { key: 'site.enabled', value: parsed.data.enabled ? 'true' : 'false' },
    {
      key: 'site.allowedOrigins',
      value: parseAllowedOrigins(parsed.data.allowedOrigins).join('\n'),
    },
    { key: 'site.defaultManagerId', value: managerId },
  ]);
  if (!result.ok) return { ok: false, error: 'save_failed' };

  revalidatePath('/admin/settings/integrations/website');
  return { ok: true };
}

export type IssueSiteTokenResult =
  { ok: true; token: string } | { ok: false; error: 'save_failed' };

/**
 * Выпуск токена формы. Открытое значение возвращается ЗДЕСЬ и больше нигде:
 * администратор копирует его в разметку сайта, а кабинет хранит только
 * зашифрованное. Перевыпуск отзывает прежний — старая форма перестанет
 * отправлять заявки, и об этом надо предупредить на экране.
 */
export async function issueSiteTokenAction(): Promise<IssueSiteTokenResult> {
  const session = await requireSettingsSection('integrations.website', 'admin');

  // 32 байта в шестнадцатеричном виде: длинный, но копируется одним движением.
  const token = randomBytes(32).toString('hex');

  const result = await saveSettings(prisma, session.sub, [{ key: 'site.formToken', value: token }]);
  if (!result.ok) return { ok: false, error: 'save_failed' };

  // Отдельное событие аудита: выпуск токена ОТЗЫВАЕТ прежний и ломает форму на
  // живом сайте, пока её код не обновят. Общая запись «настройки изменены» не
  // отличила бы это от правки списка доменов.
  await recordAudit(prisma, {
    action: 'site_form_token_issued',
    entity: 'integration_setting',
    entityId: 'site.formToken',
    userId: session.sub,
  });

  revalidatePath('/admin/settings/integrations/website');
  return { ok: true, token };
}
