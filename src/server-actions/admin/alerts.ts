'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { saveSettings, type SaveEntry, type SettingKey } from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { deliverAlert } from '@/lib/monitoring/deliver';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

/**
 * Настройки ops-оповещений (`У-126`).
 *
 * Пороги и канал доставки правились только в конфиге сервера: чтобы перестать
 * получать ложный алерт, требовалась выкладка. Раздел платформенный, поэтому
 * только администратор.
 */

export type AlertSettingsResult =
  { ok: true } | { ok: false; error: 'validation' | 'value_out_of_range' | 'secrets_key_missing' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Границы порогов. Смысл не в «красивых числах», а в том, что за ними алерты
 * перестают работать: ноль часов до повторного уведомления — это письмо
 * каждые пять минут, а тысяча задач в очереди — порог, который не сработает
 * никогда.
 */
const NUMERIC: Array<{ field: string; key: SettingKey; min: number; max: number }> = [
  { field: 'alerts_queueWaitingMax', key: 'alerts.queueWaitingMax', min: 1, max: 100_000 },
  { field: 'alerts_dlqMax', key: 'alerts.dlqMax', min: 0, max: 100_000 },
  { field: 'alerts_syncLagMaxHours', key: 'alerts.syncLagMaxHours', min: 1, max: 720 },
  { field: 'alerts_renotifyCooldownHours', key: 'alerts.renotifyCooldownHours', min: 1, max: 168 },
  { field: 'alerts_oneCDeadLetterMax', key: 'alerts.oneCDeadLetterMax', min: 0, max: 100_000 },
];

/** Простая проверка адреса: нам нужно отсечь опечатку, а не валидировать RFC. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveAlertSettingsAction(fd: FormData): Promise<AlertSettingsResult> {
  const session = await requireAdmin();

  const entries: SaveEntry[] = [];

  for (const n of NUMERIC) {
    const raw = readField(fd, n.field).trim();
    if (raw === '') {
      // Пусто — «вернуть значение сервера»: строку удаляем, а не пишем пустую.
      entries.push({ key: n.key, clear: true });
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < n.min || parsed > n.max) {
      return { ok: false, error: 'value_out_of_range' };
    }
    entries.push({ key: n.key, value: String(parsed) });
  }

  const recipients = readField(fd, 'alerts_emailRecipients').trim();
  if (recipients !== '') {
    const bad = recipients
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean)
      .filter((e) => !EMAIL_RE.test(e));
    // Опечатка в списке означала бы, что оповещения тихо уходят не туда.
    if (bad.length > 0) return { ok: false, error: 'validation' };
  }
  entries.push({ key: 'alerts.emailRecipients', value: recipients });

  entries.push({
    key: 'alerts.telegramChatId',
    value: readField(fd, 'alerts_telegramChatId').trim(),
  });
  // Пустой секрет не затирает сохранённый — общее правило `saveSettings`.
  entries.push({ key: 'alerts.telegramBotToken', value: readField(fd, 'alerts_telegramBotToken') });

  const res = await saveSettings(prisma, session.sub, entries);
  if (!res.ok) return res;

  resetIntegrationSettingsCache();
  await recordAudit(prisma, {
    action: 'alert_settings_changed',
    entity: 'alert_settings',
    entityId: 'ops',
    userId: session.sub,
  });
  revalidatePath('/admin/settings/system/health');
  return { ok: true };
}

export type TestAlertResult = { ok: true } | { ok: false; error: 'send_failed' };

/**
 * Тестовое оповещение (`У-126`).
 *
 * Идёт **тем же путём**, что настоящее: те же получатели, тот же чат, тот же
 * текстовый формат. Отдельная «проверочная» отправка своим кодом проверяла бы
 * саму себя, а не доставку.
 *
 * Помечено как проверка прямо в тексте — иначе дежурный ночью решит, что у
 * него авария.
 */
export async function sendTestAlertAction(): Promise<TestAlertResult> {
  const session = await requireAdmin();
  try {
    await deliverAlert(prisma, {
      kind: 'fire',
      message: 'Проверка канала оповещений. Это не авария — кнопку нажали в настройках.',
      type: 'ops_alert_test',
    });
    await recordAudit(prisma, {
      action: 'alert_test_sent',
      entity: 'alert_settings',
      entityId: 'ops',
      userId: session.sub,
    });
    return { ok: true };
  } catch (err) {
    log.error('[alerts] test delivery failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'send_failed' };
  }
}
