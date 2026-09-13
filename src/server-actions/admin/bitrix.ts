'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { saveSettings } from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { testIntegration } from '@/lib/services/admin/testIntegration';
import { normalizeWebhookUrl, portalHost } from '@/lib/services/bitrix/settings';
import {
  createBitrixBatch,
  getBitrixBatchState,
  saveBatchMapping,
} from '@/lib/services/bitrix/preview';

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

// ---------------------------------------------------------------------------
// Пакеты миграции (`У-193`): создание, состояние, таблицы сопоставления
// ---------------------------------------------------------------------------

const BITRIX_BATCHES_PATH = '/admin/settings/integrations/bitrix/history';

export type BitrixBatchActionResult =
  | { ok: true; batchId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'mapping_incomplete' };

/** «Новый пакет»: собирает настройки формы и ставит сухой прогон в очередь. */
export async function createBitrixBatchAction(fd: FormData): Promise<BitrixBatchActionResult> {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  if (notFoundIfDisabled('bitrix_migration')) return { ok: false, error: 'forbidden' };

  const source = readField(fd, 'source') === 'file' ? 'file' : 'rest';
  const res = await createBitrixBatch(prisma, session, {
    source,
    from: readField(fd, 'from'),
    to: readField(fd, 'to'),
    openOnly: readField(fd, 'openOnly') === 'on',
    withFiles: readField(fd, 'withFiles') === 'on',
    defaultManagerId: readField(fd, 'defaultManagerId'),
    fileKeys: parseFileKeys(readField(fd, 'fileKeys')),
  });
  if (!res.ok) return res;
  revalidatePath(BITRIX_BATCHES_PATH);
  return { ok: true, batchId: res.batchId };
}

/** Ключи загруженных выгрузок приезжают из формы файлов одной JSON-строкой. */
function parseFileKeys(raw: string): { key: string; name: string; entity: string }[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const { key, name, entity } = item as Record<string, unknown>;
      if (typeof key !== 'string' || typeof entity !== 'string' || !key) return [];
      return [{ key, name: typeof name === 'string' ? name : key, entity }];
    });
  } catch {
    return [];
  }
}

export type BitrixBatchStateResult =
  | { ok: true; status: string; progress: { step: string; done: number; total: number } | null }
  | { ok: false; error: 'forbidden' | 'not_found' };

/** Состояние пакета для полосы прогресса — зовётся по таймеру, пока идёт работа. */
export async function getBitrixBatchStateAction(batchId: string): Promise<BitrixBatchStateResult> {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  if (notFoundIfDisabled('bitrix_migration')) return { ok: false, error: 'forbidden' };
  const res = await getBitrixBatchState(prisma, session, batchId);
  if (!res.ok) return { ok: false, error: res.error === 'forbidden' ? 'forbidden' : 'not_found' };
  return {
    ok: true,
    status: res.status,
    progress: res.progress
      ? { step: res.progress.step, done: res.progress.done, total: res.progress.total }
      : null,
  };
}

export type BitrixMappingSaveResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' };

/**
 * Сохранение таблиц сопоставления из предпросмотра. Значения приходят полями
 * вида `stage:<ключ>`, `leadStage:<статус>`, `taskColumn:<статус>`, `user:<id>`
 * — по одному на строку таблицы, как в форме порогов оповещений.
 */
export async function saveBatchMappingAction(fd: FormData): Promise<BitrixMappingSaveResult> {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  if (notFoundIfDisabled('bitrix_migration')) return { ok: false, error: 'forbidden' };

  const batchId = readField(fd, 'batchId');
  if (!batchId) return { ok: false, error: 'invalid' };

  const stageMap: Record<string, string | null> = {};
  const leadStageMap: Record<string, string | null> = {};
  const taskColumnMap: Record<string, string | null> = {};
  const userMap: Record<string, string> = {};
  for (const [name, value] of fd.entries()) {
    if (typeof value !== 'string') continue;
    const [prefix, ...rest] = name.split(':');
    const key = rest.join(':');
    if (!key) continue;
    if (prefix === 'stage') stageMap[key] = value || null;
    else if (prefix === 'leadStage') leadStageMap[key] = value || null;
    else if (prefix === 'taskColumn') taskColumnMap[key] = value || null;
    else if (prefix === 'user' && value) userMap[key] = value;
  }

  const res = await saveBatchMapping(prisma, session, {
    batchId,
    tables: { stageMap, leadStageMap, taskColumnMap, userMap },
  });
  if (!res.ok)
    return {
      ok: false,
      error:
        res.error === 'forbidden'
          ? 'forbidden'
          : res.error === 'not_found'
            ? 'not_found'
            : 'invalid',
    };
  revalidatePath(`${BITRIX_BATCHES_PATH}/${batchId}`);
  return { ok: true };
}
