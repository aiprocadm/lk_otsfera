/**
 * Пользовательские настройки каналов (D2) — чистые парс-хелперы без Prisma.
 *
 * Хранение: `User.notificationChannels Json?` вида
 * `{ telegram?: boolean, max?: boolean, whatsapp?: boolean }`.
 * Семантика opt-in: канал включён ⟺ привязка есть И `prefs[key] !== false` —
 * привязка и есть акт opt-in (пользователь явно жмёт «Привязать»), toggle
 * позволяет замьютить канал без отвязки. Email в prefs не хранится: базовый
 * канал всегда включён и не отключается (ТЗ §12.1).
 */
import { z } from 'zod';
import { ROUTABLE_CHANNELS } from '../routing';
import type { ChannelKey } from './types';

/** Каналы, которыми управляет пользователь (email намеренно исключён). */
const OPTIONAL_CHANNEL_KEYS = [
  'telegram',
  'max',
  'whatsapp',
] as const satisfies readonly ChannelKey[];
export type OptionalChannelKey = (typeof OPTIONAL_CHANNEL_KEYS)[number];

export type ChannelPrefs = Partial<Record<OptionalChannelKey, boolean | undefined>>;

const prefsSchema = z.object({
  telegram: z.boolean().optional(),
  max: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

/**
 * Терпимый парсер Json-колонки: null/мусор/чужие ключи → дефолты (пустой
 * объект = ничего не выключено). Настройки — не критичные данные; сломанное
 * значение не должно ронять доставку уведомлений.
 */
export function parseChannelPrefs(raw: unknown): ChannelPrefs {
  const parsed = prefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** `!== false`: отсутствие ключа = включено (при наличии привязки). */
export function channelPrefEnabled(raw: unknown, key: OptionalChannelKey): boolean {
  return parseChannelPrefs(raw)[key] !== false;
}

export function isOptionalChannelKey(value: string): value is OptionalChannelKey {
  return (OPTIONAL_CHANNEL_KEYS as readonly string[]).includes(value);
}

/**
 * `У-229` (решение `Р-Э5-4`): личная настройка только СУЖАЕТ веер каналов.
 *
 * `channels` — то, что разрешила компания (`undefined` = ограничений нет).
 * Нет строки настройки для события → веер не меняется. Есть строка → остаются
 * только каналы, включённые в ней. Расширить веер настройка не может по
 * построению: результат — пересечение, а не объединение.
 *
 * Одна функция на обе ветки доставки (inline и очередь): второй копии этого
 * правила в проекте быть не должно.
 */
export function narrowByEventPreference(
  prefs: ReadonlyArray<{ eventType: string; channels: string[] }> | null | undefined,
  eventType: string,
  channels: readonly ChannelKey[] | undefined
): ChannelKey[] | undefined {
  const pref = prefs?.find((p) => p.eventType === eventType);
  if (!pref) return channels ? [...channels] : undefined;
  const allowed = new Set(pref.channels);
  const base: readonly ChannelKey[] = channels ?? ROUTABLE_CHANNELS;
  return base.filter((ch) => allowed.has(ch));
}
