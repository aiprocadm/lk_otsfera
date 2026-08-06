const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // Минимальная CSP без script-src: App Router с инлайн-скриптами Next требует
  // nonce-инфраструктуру через middleware — отложено (R2). Эти директивы
  // безопасны без nonce и закрывают: встраивание в iframe (дублирует XFO),
  // object/embed-инъекции, подмену <base>, увод form action на чужой origin.
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

/**
 * Хаб «Настройки» (ТЗ 2026-08-04 §5.1): старые адреса служебных разделов
 * переезжают на новые НАСТОЯЩИМ HTTP-редиректом. Страница-шлюз с `redirect()`
 * тоже осталась (вторая линия), но при стриминге RSC она отдаёт 200 и уводит
 * уже на клиенте — закладке и внешнему клиенту нужен честный код ответа.
 *
 * Список продублирован здесь намеренно: `next.config.mjs` читается до сборки и
 * не может импортировать TS-реестр. От расхождения защищает тест
 * `lib.navigation.settings-redirect` — он сверяет эту карту с реестром.
 *
 * Редирект временный (307): постоянный 308 браузер кэширует навсегда, и откат
 * флага раскатки оставил бы пользователей с мёртвой навигацией. Переключить на
 * постоянный — шагом снятия флага после приёмки.
 */
export const SETTINGS_HUB_REDIRECTS = [
  ['/admin/health', '/admin/settings/system/health'],
  ['/admin/integrations', '/admin/settings/integrations'],
  ['/admin/sync', '/admin/settings/integrations/sync'],
  ['/admin/import', '/admin/settings/integrations/1c/excel'],
  ['/admin/payments-import', '/admin/settings/integrations/1c/payments'],
  ['/manager/import', '/leader/settings/integrations/1c/excel'],
  ['/manager/payments-import', '/leader/settings/integrations/1c/payments'],
  ['/admin/roles', '/admin/settings/access/roles'],
  ['/leader/roles', '/leader/settings/access/roles'],
  ['/admin/order-statuses', '/admin/settings/catalogs/application-statuses'],
  ['/leader/settings/order-statuses', '/leader/settings/catalogs/application-statuses'],
  ['/admin/custom-fields', '/admin/settings/catalogs/custom-fields'],
  ['/leader/settings/custom-fields', '/leader/settings/catalogs/custom-fields'],
  ['/admin/pii-access', '/admin/settings/security/personal-data'],
  ['/admin/audit', '/admin/settings/security/audit'],
];

/** Тот же разбор значения, что и в src/lib/featureFlags.ts (opt-in флаг). */
function isSettingsHubEnabled() {
  const raw = process.env.FEATURE_SETTINGS_HUB?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/**
 * Предел размера тела server action'а. Общий на все действия форм, поэтому
 * обязан быть НЕ МЕНЬШЕ самого крупного файлового действия — иначе Next режет
 * тело раньше, чем код успевает проверить размер и вежливо отказать (ТЗ
 * починки импорта, Т-5; раньше здесь стояло 10 МБ при обещанных 20).
 *
 * Синхронизировано с `IMPORT_MAX_FILE_MB` из src/lib/config/import-limits.ts —
 * конфиг читается до сборки и импортировать TS не может; расхождение ловит
 * тест `lib.config.import-limits`.
 */
export const SERVER_ACTIONS_BODY_LIMIT_MB = 25;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: `${SERVER_ACTIONS_BODY_LIMIT_MB}mb` },
  },
  // pino использует Node-API (streams/sonic-boom) — оставить внешним пакетом,
  // а не бандлить в серверный граф RSC.
  serverExternalPackages: ['pino'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    if (!isSettingsHubEnabled()) return [];
    return SETTINGS_HUB_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default nextConfig;
