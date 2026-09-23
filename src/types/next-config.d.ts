/**
 * `next.config.mjs` — обычный JS без типов, но тест `lib.config.import-limits`
 * импортирует из него предел тела server action'а, чтобы сверить его с
 * `IMPORT_MAX_FILE_MB`. Объявление даёт этому импорту тип и держит
 * `noImplicitAny` довольным.
 *
 * Карт редиректов со старых адресов здесь больше нет: шлюзы удалены
 * (`У-263`, прогон сопровождения №37).
 */
declare module '*/next.config.mjs' {
  export const SERVER_ACTIONS_BODY_LIMIT_MB: number;
  const nextConfig: unknown;
  export default nextConfig;
}
