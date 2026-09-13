import type { PrismaClient } from '@prisma/client';
import { getSettingValues } from '@/lib/config/integrationSettings';

/**
 * Настройки подключения к Битрикс24 (`У-188`, `У-199`). Ключи живут в
 * `IntegrationSetting` (`bitrix.*`), вебхук — секрет. Наружу из этого модуля
 * URL вебхука уходит только в клиент; в логи, аудит и на экран — `portalHost`.
 */
export type BitrixConnection = {
  portalUrl: string | null;
  webhookUrl: string | null;
  defaultManagerId: string | null;
  userMap: Record<string, string>;
};

export async function loadBitrixConnection(prisma: PrismaClient): Promise<BitrixConnection> {
  const values = await getSettingValues(prisma, [
    'bitrix.portalUrl',
    'bitrix.webhookUrl',
    'bitrix.defaultManagerId',
    'bitrix.userMap',
  ]);
  return {
    portalUrl: values['bitrix.portalUrl'] ?? null,
    webhookUrl: values['bitrix.webhookUrl'] ?? null,
    defaultManagerId: values['bitrix.defaultManagerId'] ?? null,
    userMap: parseUserMap(values['bitrix.userMap'] ?? null),
  };
}

/**
 * Домен портала из любого адреса Битрикса — единственное, что можно писать в
 * логи и аудит: URL вебхука содержит токен (`У-199`). Кривой адрес → пустая
 * строка, а не исключение: диагностика не должна падать на опечатке.
 */
export function portalHost(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).host;
  } catch {
    return '';
  }
}

/** Таблица «id пользователя Битрикса → id пользователя ЛК»; мусор → пусто. */
export function parseUserMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v && k) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Проверка формы входящего вебхука: `https://<портал>/rest/<userId>/<token>/`.
 * Хвостовой слэш и путь метода допускаются — нормализуем к базе без метода.
 */
export function normalizeWebhookUrl(raw: string): { ok: true; url: string } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== 'https:') return { ok: false };
  const m = parsed.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9]+)\/?/);
  if (!m) return { ok: false };
  return { ok: true, url: `${parsed.origin}/rest/${m[1]}/${m[2]}/` };
}
