'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  SETTING_SPECS,
  saveSettings,
  type SaveEntry,
  type SettingKey,
} from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { resetEmailTransportCache } from '@/lib/email/transport';
import { __resetInboundEmailAdapter } from '@/lib/inbound/email';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import { testIntegration } from '@/lib/services/admin/testIntegration';

export type IntegrationSaveResult =
  { ok: true } | { ok: false; error: 'secrets_key_missing' | 'validation' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Сохранение настроек исходящей почты. Секрет (ключ Resend) присылается пустым,
 * если админ не вводил новый — тогда сервис его не затирает. После записи
 * сбрасываем кэш транспорта, чтобы новый ключ подхватился без перезапуска.
 */
export async function saveEmailSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();

  const enabled = fd.get('email_enabled') === 'on' || fd.get('email_enabled') === 'true';
  const from = readField(fd, 'email_from').trim();
  const apiKey = readField(fd, 'email_resendApiKey');

  const entries: SaveEntry[] = [
    { key: 'email.enabled', value: enabled ? 'true' : 'false' },
    { key: 'email.from', value: from },
    // Пустой ключ → saveSettings оставит существующий как есть.
    { key: 'email.resendApiKey', value: apiKey },
  ];

  const res = await saveSettings(prisma, session.sub, entries);
  if (!res.ok) return res;

  resetEmailTransportCache();
  resetIntegrationSettingsCache();
  revalidatePath('/admin/settings/integrations');
  return { ok: true };
}

/**
 * Общий хвост actions волны 2 (спека 2026-07-22 §4): saveSettings → сброс
 * кэша настроек (синхронные читатели — мессенджеры, Mango, IMAP — перечитают
 * БД при следующем prime) → revalidate. Auth — в каждом action до валидации.
 */
async function saveGroup(
  actorUserId: string,
  entries: SaveEntry[]
): Promise<IntegrationSaveResult> {
  const res = await saveSettings(prisma, actorUserId, entries);
  if (!res.ok) return res;
  resetIntegrationSettingsCache();
  revalidatePath('/admin/settings/integrations');
  return { ok: true };
}

/**
 * Сброс одной настройки к значению сервера (`У-131`).
 *
 * Введённый в интерфейсе параметр перекрывает переменную окружения — и вернуть
 * его обратно было нельзя: пустое поле для секрета означает «не менять», а не
 * «убрать». Приходилось лезть в базу руками. Теперь есть явное действие:
 * строка удаляется, и снова начинает действовать значение с сервера.
 *
 * Ключ проверяется по реестру: чужая строка из формы не должна удалять
 * произвольную запись настроек.
 */
export async function resetSettingToServerValueAction(
  rawKey: string
): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  if (!(rawKey in SETTING_SPECS)) return { ok: false, error: 'validation' };
  return saveGroup(session.sub, [{ key: rawKey as SettingKey, clear: true }]);
}

/** Пара «несекретное поле + секрет»: у ботов Telegram/Max одинаковая форма. */
function botEntries(
  fd: FormData,
  tokenKey: SettingKey,
  usernameKey: SettingKey,
  prefix: string
): SaveEntry[] {
  return [
    { key: usernameKey, value: readField(fd, `${prefix}_botUsername`).trim() },
    // Пустой токен → saveSettings оставит существующий как есть.
    { key: tokenKey, value: readField(fd, `${prefix}_botToken`) },
  ];
}

export async function saveTelegramSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  return saveGroup(
    session.sub,
    botEntries(fd, 'telegram.botToken', 'telegram.botUsername', 'telegram')
  );
}

export async function saveMaxSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  return saveGroup(session.sub, [
    ...botEntries(fd, 'max.botToken', 'max.botUsername', 'max'),
    { key: 'max.baseUrl', value: readField(fd, 'max_baseUrl').trim() },
  ]);
}

export async function saveWhatsappSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  return saveGroup(session.sub, [
    { key: 'whatsapp.baseUrl', value: readField(fd, 'whatsapp_baseUrl').trim() },
    { key: 'whatsapp.apiKey', value: readField(fd, 'whatsapp_apiKey') },
    { key: 'whatsapp.channelId', value: readField(fd, 'whatsapp_channelId') },
  ]);
}

export async function saveMangoSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  return saveGroup(session.sub, [
    { key: 'mango.vpbxBaseUrl', value: readField(fd, 'mango_vpbxBaseUrl').trim() },
    { key: 'mango.apiKey', value: readField(fd, 'mango_apiKey') },
    { key: 'mango.apiSalt', value: readField(fd, 'mango_apiSalt') },
  ]);
}

export async function saveImapSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  const adapter = readField(fd, 'imap_adapter').trim().toLowerCase();
  if (adapter !== 'fake' && adapter !== 'imap') {
    return { ok: false, error: 'validation' };
  }
  const port = readField(fd, 'imap_port').trim();
  if (port !== '' && !/^\d{1,5}$/.test(port)) {
    return { ok: false, error: 'validation' };
  }

  const res = await saveGroup(session.sub, [
    { key: 'imap.adapter', value: adapter },
    { key: 'imap.host', value: readField(fd, 'imap_host').trim() },
    { key: 'imap.port', value: port },
    { key: 'imap.user', value: readField(fd, 'imap_user').trim() },
    {
      key: 'imap.tls',
      value: fd.get('imap_tls') === 'on' || fd.get('imap_tls') === 'true' ? '1' : '0',
    },
    { key: 'imap.password', value: readField(fd, 'imap_password') },
  ]);
  if (!res.ok) return res;

  // Смена вида/конфига адаптера в этом процессе — пересборка синглтона
  // (воркер подхватит сам через prime в poll-процессоре).
  __resetInboundEmailAdapter();
  return { ok: true };
}

/**
 * Настройки обмена с 1С. Вид адаптера — только fake|rest (file не готов).
 * После сохранения сбрасываем синглтон адаптера 1С, чтобы новый конфиг
 * подхватился в этом процессе; воркер праймит кэш сам в sync-процессорах.
 */
export async function saveOnecSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  const adapter = readField(fd, 'onec_adapter').trim().toLowerCase();
  if (adapter !== 'fake' && adapter !== 'rest') {
    return { ok: false, error: 'validation' };
  }

  const res = await saveGroup(session.sub, [
    { key: 'onec.adapter', value: adapter },
    { key: 'onec.apiUrl', value: readField(fd, 'onec_apiUrl').trim() },
    { key: 'onec.healthPath', value: readField(fd, 'onec_healthPath').trim() },
    { key: 'onec.apiToken', value: readField(fd, 'onec_apiToken') },
  ]);
  if (!res.ok) return res;

  resetOneCAdapter();
  return { ok: true };
}

export type IntegrationTestActionResult =
  { ok: true; success: boolean; message: string } | { ok: false; error: string };

/**
 * «Проверить подключение» (ФТ-14.3): универсальная проба по данным, которые
 * ввёл админ. Ключ интеграции привязывается на сервере через `.bind(null, key)`
 * в page.tsx; FormData от кнопки формы игнорируется. Результат пробы пишется
 * в SyncState — revalidate обновляет строку «последняя проверка».
 */
export async function testIntegrationAction(
  key: string,
  _fd: FormData
): Promise<IntegrationTestActionResult> {
  void _fd; // поля формы пробе не нужны — берём сохранённые настройки
  const session = await requireAdmin();
  const res = await testIntegration(prisma, session, key);
  if (!res.ok) return res;
  revalidatePath('/admin/settings/integrations');
  return res;
}

/** Настройки DaData: включение + ключ (секрет). */
export async function saveDadataSettingsAction(fd: FormData): Promise<IntegrationSaveResult> {
  const session = await requireAdmin();
  const enabled = fd.get('dadata_enabled') === 'on' || fd.get('dadata_enabled') === 'true';
  return saveGroup(session.sub, [
    { key: 'dadata.enabled', value: enabled ? 'true' : 'false' },
    // Пустой ключ → saveSettings оставит существующий как есть.
    { key: 'dadata.apiKey', value: readField(fd, 'dadata_apiKey') },
  ]);
}
