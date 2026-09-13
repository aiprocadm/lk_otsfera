'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { saveSettings } from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { testIntegration } from '@/lib/services/admin/testIntegration';
import { normalizeWebhookUrl, portalHost } from '@/lib/services/bitrix/settings';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» — действия раздела
 * `integrations.bitrix` (`У-188`, `У-202`). Каждое действие само проверяет
 * раздел и флаг: скрытая карточка — внешний вид, а не защита (§4). Флаг
 * `bitrix_migration` поведенческий: выключен → `forbidden`.
 */

export type BitrixConnectionSaveResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'secrets_key_missing' | 'validation'; message?: string };

const BITRIX_SETTINGS_PATH = '/admin/settings/integrations/bitrix';

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

export async function saveBitrixConnectionAction(
  fd: FormData
): Promise<BitrixConnectionSaveResult> {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  if (notFoundIfDisabled('bitrix_migration')) return { ok: false, error: 'forbidden' };

  // Домен портала — из любого написания («company.bitrix24.ru», «https://…/»).
  const portalRaw = readField(fd, 'bitrix_portalUrl').trim();
  const portal = portalRaw ? portalHost(portalRaw) : '';
  if (portalRaw && !portal) {
    return { ok: false, error: 'validation', message: 'Адрес портала указан неверно.' };
  }

  // Вебхук: пустое поле = «не менять» (секрет), непустое — проверяем форму.
  const webhookRaw = readField(fd, 'bitrix_webhookUrl');
  let webhook = '';
  if (webhookRaw.trim()) {
    const normalized = normalizeWebhookUrl(webhookRaw);
    if (!normalized.ok) {
      return {
        ok: false,
        error: 'validation',
        message: 'Вебхук должен иметь вид https://<портал>/rest/<id>/<ключ>/.',
      };
    }
    webhook = normalized.url;
  }

  const defaultManagerId = readField(fd, 'bitrix_defaultManagerId').trim();
  if (defaultManagerId) {
    const manager = await prisma.user.findFirst({
      where: {
        id: defaultManagerId,
        role: { in: ['manager', 'leader'] },
        isActive: true,
        companyId: session.companyId ?? '__none__',
      },
      select: { id: true },
    });
    if (!manager) {
      return {
        ok: false,
        error: 'validation',
        message: 'Менеджер по умолчанию не найден в вашей компании.',
      };
    }
  }

  const res = await saveSettings(prisma, session.sub, [
    { key: 'bitrix.portalUrl', value: portal },
    { key: 'bitrix.webhookUrl', value: webhook },
    { key: 'bitrix.defaultManagerId', value: defaultManagerId },
  ]);
  if (!res.ok) return res;

  resetIntegrationSettingsCache();
  revalidatePath(BITRIX_SETTINGS_PATH);
  return { ok: true };
}

export type BitrixTestResult =
  { ok: true; success: boolean; message: string } | { ok: false; error: string };

/** «Проверить подключение»: та же универсальная проба, что у остальных интеграций. */
export async function testBitrixConnectionAction(_fd: FormData): Promise<BitrixTestResult> {
  void _fd;
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  if (notFoundIfDisabled('bitrix_migration')) return { ok: false, error: 'forbidden' };
  const res = await testIntegration(prisma, session, 'bitrix');
  if (!res.ok) return res;
  revalidatePath(BITRIX_SETTINGS_PATH);
  return res;
}
