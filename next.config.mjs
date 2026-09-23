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
 * HTTP-редиректов со старых адресов здесь больше нет (`У-263`, прогон
 * сопровождения №37, 23.09.2026). Раньше два списка — служебные разделы,
 * переехавшие в хаб «Настройки», и `/organization/team` — уводили закладки на
 * новое место. Заказчик решил не ждать 90 дней: шлюзы удалены, старый адрес
 * отвечает общей страницей 404 «раздел переехал» (`src/app/not-found.tsx`) с
 * кнопкой в кабинет. Список удалённых адресов — `src/lib/navigation/removedPaths.ts`;
 * вернуть сюда `redirects()` не даёт страж `navigation.legacy-gateways`.
 */

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
};

export default nextConfig;
