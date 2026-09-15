import { scrubString } from '@/lib/logging/scrub';

/**
 * Причина, по которой сообщение не ушло (`У-213`).
 *
 * Зачем отдельный модуль: текст показывается ЧЕЛОВЕКУ в ленте диалога и
 * сохраняется в базу. Значит, к нему два требования сразу — он должен быть
 * понятен без чтения логов и не должен содержать секретов. Раньше причина
 * просто терялась: все три транспорта возвращали `{ ok: false }`, и сотрудник
 * видел «не доставлено» без единого слова о том, что делать.
 *
 * Модуль чистый: ни сети, ни базы — его одинаково зовут клиенты ботов и тесты.
 */

/** Предел длины: в ленте это одна строка, а не простыня от провайдера. */
const MAX_LEN = 300;

/**
 * Токен бота Telegram стоит прямо в АДРЕСЕ запроса
 * (`api.telegram.org/bot<токен>/sendMessage`), и сообщение об ошибке сети
 * обычно этот адрес содержит. Общий `scrubString` такой формы не знает — он
 * чистит токены в параметрах запроса, а не в пути. Поэтому отдельное правило:
 * без него ключ бота лёг бы в базу и на экран.
 */
const BOT_TOKEN_IN_PATH = /\/bot\d+:[\w-]+/gi;

/**
 * Токен доступа MAX передаётся параметром `access_token`, и общий `scrubString`
 * его НЕ ловит: его правило требует `?` или `&` вплотную к слову `token`, а тут
 * перед ним стоит `access_`. Проверено вживую — секрет проходил насквозь.
 * Пока спасала лишь дисциплина вызывающих (адрес в текст не подмешивали), но
 * защита, которая держится на дисциплине, однажды перестаёт держаться.
 */
const PREFIXED_TOKEN_PARAM = /([?&][\w-]*(?:token|secret|key)=)[^&\s'"]+/gi;

export function safeDeliveryError(raw: string): string {
  const cleaned = scrubString(
    raw.replace(BOT_TOKEN_IN_PATH, '/bot[REDACTED]').replace(PREFIXED_TOKEN_PARAM, '$1[REDACTED]')
  ).trim();
  if (!cleaned) return 'Причина неизвестна';
  return cleaned.length > MAX_LEN ? `${cleaned.slice(0, MAX_LEN - 1)}…` : cleaned;
}

/** Ответ провайдера с кодом — человеческим языком. */
export function httpDeliveryError(providerLabel: string, status: number, detail?: string): string {
  const base =
    status === 401 || status === 403
      ? `${providerLabel} отклонил отправку (${status})`
      : `${providerLabel} ответил ошибкой ${status}`;
  return safeDeliveryError(detail ? `${base}: ${detail}` : base);
}

/** Сеть не ответила вовсе: таймаут, обрыв, недоступный узел. */
export function networkDeliveryError(providerLabel: string): string {
  return `${providerLabel} недоступен: сеть не ответила или истекло время ожидания`;
}

/** Канал не настроен — это к администратору, а не к клиенту. */
export function notConfiguredDeliveryError(providerLabel: string): string {
  return `${providerLabel} не настроен: не заданы ключи в настройках интеграций`;
}
