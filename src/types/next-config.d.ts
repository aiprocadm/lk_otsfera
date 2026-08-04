/**
 * `next.config.mjs` — обычный JS без типов, но тест
 * `lib.navigation.settings-redirect` импортирует из него карту редиректов
 * хаба «Настройки», чтобы сверить её с реестром разделов. Объявление даёт
 * этому импорту тип и держит `noImplicitAny` довольным.
 */
declare module '*/next.config.mjs' {
  export const SETTINGS_HUB_REDIRECTS: ReadonlyArray<readonly [string, string]>;
  const nextConfig: unknown;
  export default nextConfig;
}
