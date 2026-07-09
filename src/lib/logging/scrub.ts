/**
 * Редакция чувствительных данных перед записью в лог / отправкой в Sentry
 * (CLAUDE.md §12; ТЗ §16 «не логировать ПДн и секреты»).
 *
 * Два уровня:
 *  - ключи объектов из SENSITIVE_KEYS (без учёта регистра, на любой глубине);
 *  - паттерны внутри строк: JWT, token=/code=/secret= в URL, email-адреса.
 *
 * Error намеренно сводится к { name, message, stack } (после паттерн-скраба):
 * message/stack — главный диагностический сигнал, а кастомные поля ошибок
 * (в т.ч. ответы внешних API с ПДн) проходят через общий объектный скраб.
 *
 * Ключи матчатся ТОЧНО (lowercase) плюс несколько суффиксов; substring-матч
 * не используется сознательно: `name` внутри `queueName`/`fileName` — ложное
 * срабатывание, которое стирает диагностику. Суффиксы выбраны так, чтобы не
 * задевать безопасные ключи (`statusCode` не редактируется: `code` — точный
 * ключ, а не суффикс).
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  // ПДн (prisma: User/Student/Lead/InboundMessage/Call)
  'name',
  'email',
  'to',
  'cc',
  'bcc',
  'phone',
  'whatsappphone',
  'callernumber',
  'internalnumber',
  'clientcontactname',
  'clientcontactphone',
  'clientcontactemail',
  'clientinn',
  'senderref',
  'senderdisplay',
  'subject',
  'body',
  'text',
  'html',
  'snils',
  'birthdate',
  // секреты и одноразовые артефакты
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'apitoken',
  'bottoken',
  'code',
  'jti',
  'secret',
  'websocketsecret',
  'webhooksecret',
  'apikey',
  'authorization',
  'cookie',
  'inviteurl',
  'reseturl',
  'telegramchatid',
  'telegramlinkcode',
  'maxchatid',
  'maxlinkcode'
]);

const SENSITIVE_SUFFIXES = ['email', 'phone', 'password', 'secret', 'apikey'];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_KEYS.has(k)) return true;
  return SENSITIVE_SUFFIXES.some((s) => k.endsWith(s));
}

/** Паттерны, вычищаемые из ЛЮБОЙ строки (значения ключей уже отредактированы). */
const STRING_PATTERNS: Array<[RegExp, string]> = [
  // JWT (три base64url-сегмента, header всегда начинается с eyJ)
  [/eyJ[\w-]{4,}\.[\w-]+\.[\w-]+/g, REDACTED],
  // одноразовые артефакты в query-параметрах URL (bridge code, reset token)
  [/([?&](?:token|code|secret|key|apikey|api_key)=)[^&\s'"]+/gi, `$1${REDACTED}`],
  // email-адреса в свободном тексте (сообщения Resend/SMTP содержат адресата)
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, REDACTED]
];

export function scrubString(value: string): string {
  let out = value;
  for (const [re, repl] of STRING_PATTERNS) out = out.replace(re, repl);
  return out;
}

const MAX_DEPTH = 6;

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined
    };
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, depth + 1, seen));
  }
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

/**
 * Глубокая копия значения с редакцией чувствительных ключей и строковых
 * паттернов. Исходный объект не мутируется.
 */
export function scrub(value: unknown): unknown {
  return scrubValue(value, 0, new WeakSet());
}

/**
 * beforeSend-скраббер для Sentry. Типизирован структурно (без импорта SDK):
 * контракт — event-подобный объект Sentry v10. Мутирует и возвращает event
 * (beforeSend это разрешает) — глубокая копия не нужна, событие одноразовое.
 */
export interface SentryEventLike {
  message?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    data?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  user?: unknown;
}

export function scrubSentryEvent<E extends SentryEventLike>(event: E): E {
  if (event.message) event.message = scrubString(event.message);
  if (event.request) {
    const req = event.request;
    if (req.url) req.url = scrubString(req.url);
    // cookies несут session-JWT (src/lib/auth/session.ts) — убираем целиком
    delete req.cookies;
    delete req.query_string;
    if (req.headers) {
      for (const h of Object.keys(req.headers)) {
        if (isSensitiveKey(h)) req.headers[h] = REDACTED;
      }
    }
    if (req.data !== undefined) req.data = scrub(req.data);
  }
  for (const v of event.exception?.values ?? []) {
    if (v.value) v.value = scrubString(v.value);
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubString(b.message);
    if (b.data !== undefined) b.data = scrub(b.data);
  }
  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrub(event.contexts) as Record<string, unknown>;
  // user может содержать email/ip — идентификация в Sentry не нужна (152-ФЗ)
  delete event.user;
  return event;
}
