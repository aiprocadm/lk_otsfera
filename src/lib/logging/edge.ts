/**
 * Edge-safe логгер для middleware (единственный edge-модуль проекта).
 * pino в edge runtime не работает (Node streams) — поэтому production-транспорт
 * здесь: JSON-строка через console.* (стандартный sink edge-платформ).
 * В dev/test — verbatim passthrough, как у серверного логгера.
 */
import { scrub } from './scrub';

type Level = 'debug' | 'info' | 'warn' | 'error';

/* eslint-disable no-console -- edge-транспорт: console — единственный sink
   в edge runtime; это санкционированная обёртка (см. док-блок). Лукап
   console.X в момент вызова — чтобы vi.spyOn(console, …) в тестах работал. */
const CONSOLE_SINK: Record<Level, (...a: unknown[]) => void> = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a)
};
/* eslint-enable no-console */

function emit(level: Level, msg: string, args: unknown[]): void {
  if (process.env.NODE_ENV === 'production') {
    CONSOLE_SINK[level](
      JSON.stringify({
        level,
        time: Date.now(),
        msg,
        ...(args.length ? { ctx: scrub(args.length === 1 ? args[0] : args) } : {})
      })
    );
    return;
  }
  CONSOLE_SINK[level](msg, ...args);
}

export const edgeLog = {
  debug: (msg: string, ...args: unknown[]) => emit('debug', msg, args),
  info: (msg: string, ...args: unknown[]) => emit('info', msg, args),
  warn: (msg: string, ...args: unknown[]) => emit('warn', msg, args),
  error: (msg: string, ...args: unknown[]) => emit('error', msg, args)
};
