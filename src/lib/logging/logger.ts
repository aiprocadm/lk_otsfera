/**
 * Структурный серверный логгер (Node runtime: services, server-actions,
 * route-handlers, worker). Единственная санкционированная точка логирования —
 * eslint `no-console` запрещает сырой console.* в src/** (см. eslint.config.mjs).
 *
 * Транспорт выбирается окружением:
 *  - production (или LOG_FORMAT=json) → pino: JSON-строки, уровень из
 *    LOG_LEVEL, редакция ПДн/секретов через scrub() (CLAUDE.md §12);
 *  - dev/test → console-passthrough С ТЕМИ ЖЕ аргументами. Это сознательный
 *    контракт: ~37 тестовых файлов ассертят console.warn/error/log конкретных
 *    модулей (graceful-degrade пути) и прибиты к формату сообщений. Скраббинг
 *    в passthrough НЕ применяется (аргументы должны совпадать по ссылке) —
 *    он покрыт собственными тестами pino-ветки и scrub().
 *
 * Маппинг info → console.log (не console.info): worker-тесты прибиты к
 * console.log для start/done-логов.
 *
 * Edge runtime — НЕ сюда: pino не работает в edge, используй
 * `@/lib/logging/edge`. Клиентские компоненты — `@/lib/logging/client`.
 */
import pino from 'pino';
import { scrub } from './scrub';

export interface AppLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  /** Корреляционные байндинги (requestId, jobId, queue, …) для всех записей. */
  child(bindings: Record<string, unknown>): AppLogger;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface CreateLoggerOptions {
  mode: 'json' | 'console';
  level?: string;
  bindings?: Record<string, unknown>;
  /** Тестовый sink для json-режима (pino destination). */
  destination?: pino.DestinationStream;
}

/** Пакует variadic-аргументы call-site'а в поле ctx JSON-записи. */
function toCtx(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  return scrub(args.length === 1 ? args[0] : args);
}

function fromPino(p: pino.Logger): AppLogger {
  const emit = (level: Level, msg: string, args: unknown[]) => {
    const ctx = toCtx(args);
    if (ctx === undefined) p[level](msg);
    else p[level]({ ctx }, msg);
  };
  return {
    debug: (msg, ...args) => emit('debug', msg, args),
    info: (msg, ...args) => emit('info', msg, args),
    warn: (msg, ...args) => emit('warn', msg, args),
    error: (msg, ...args) => emit('error', msg, args),
    child: (bindings) => fromPino(p.child(scrub(bindings) as Record<string, unknown>))
  };
}

/* eslint-disable no-console -- console-транспорт dev/test-режима: единственное
   санкционированное место сырого console в src (см. док-блок модуля).
   Лукап console.X — В МОМЕНТ ВЫЗОВА (не захват ссылки при импорте): тесты
   ставят vi.spyOn(console, …) после импортов, захваченная ссылка обошла бы шпиона. */
const CONSOLE_SINK: Record<Level, (...a: unknown[]) => void> = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a)
};
/* eslint-enable no-console */

function consoleLogger(bindings?: Record<string, unknown>): AppLogger {
  const hasBindings = bindings !== undefined && Object.keys(bindings).length > 0;
  const emit = (level: Level, msg: string, args: unknown[]) => {
    // Байндинги — хвостовым аргументом, чтобы не менять прибитый тестами
    // формат (msg, ...args) у логгеров без child().
    if (hasBindings) CONSOLE_SINK[level](msg, ...args, bindings);
    else CONSOLE_SINK[level](msg, ...args);
  };
  return {
    debug: (msg, ...args) => emit('debug', msg, args),
    info: (msg, ...args) => emit('info', msg, args),
    warn: (msg, ...args) => emit('warn', msg, args),
    error: (msg, ...args) => emit('error', msg, args),
    child: (extra) => consoleLogger({ ...bindings, ...extra })
  };
}

export function createLogger(opts: CreateLoggerOptions): AppLogger {
  if (opts.mode === 'console') return consoleLogger(opts.bindings);
  const p = pino(
    {
      level: opts.level ?? 'info',
      base: opts.bindings ?? {},
      // Машиночитаемый uppercase-уровень не нужен — дефолтный числовой pino-
      // level понятен коллекторам; timestamp дефолтный (epoch ms).
      messageKey: 'msg'
    },
    opts.destination
  );
  return fromPino(p);
}

/** Экспортирован для прямого тестирования веток выбора режима. */
export function modeFromEnv(): 'json' | 'console' {
  if (process.env.LOG_FORMAT === 'json') return 'json';
  if (process.env.LOG_FORMAT === 'console') return 'console';
  return process.env.NODE_ENV === 'production' ? 'json' : 'console';
}

/** Логгер процесса. Импортируй именно его: `import { log } from '@/lib/logging'`. */
export const log: AppLogger = createLogger({
  mode: modeFromEnv(),
  level: process.env.LOG_LEVEL
});
