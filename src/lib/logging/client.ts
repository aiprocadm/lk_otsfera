/**
 * Логгер для 'use client'-компонентов. Браузерная консоль — естественный и
 * единственный sink на клиенте (серверный pino сюда не тянем), поэтому это
 * verbatim-обёртка: она существует, чтобы (а) eslint `no-console` держал
 * src/** чистым, (б) была единая точка для будущего клиентского Sentry.
 * ПДн-скраббинг на клиенте не применяется: лог остаётся в браузере пользователя.
 */

/* eslint-disable no-console -- клиентский транспорт: console — единственный
   sink в браузере; санкционированная обёртка (см. док-блок). */
export const clientLog = {
  debug: (msg: string, ...args: unknown[]) => console.debug(msg, ...args),
  info: (msg: string, ...args: unknown[]) => console.log(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(msg, ...args)
};
/* eslint-enable no-console */
