/**
 * Логгер для 'use client'-компонентов. Браузерная консоль — естественный и
 * единственный sink на клиенте (серверный pino сюда не тянем), поэтому это
 * verbatim-обёртка: она существует, чтобы (а) eslint `no-console` держал
 * src/** чистым, (б) была единая точка для будущего клиентского Sentry.
 * ПДн-скраббинг на клиенте не применяется: лог остаётся в браузере пользователя.
 */

/* eslint-disable no-console -- клиентский транспорт: console — единственный
   sink в браузере; санкционированная обёртка (см. док-блок). Полностью
   variadic (без обязательной строки): error-boundary передают Error первым
   аргументом, как принимает и сам console. */
export const clientLog = {
  debug: (...args: unknown[]) => console.debug(...args),
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
};
/* eslint-enable no-console */
