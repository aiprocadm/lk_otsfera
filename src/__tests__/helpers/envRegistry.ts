/**
 * Реестр переменных окружения, которые ОСТАЮТСЯ в env (`У-122`).
 *
 * Всё, чего здесь нет и что не объявлено `envVar` в `SETTING_SPECS`
 * ([integrationSettings.ts](../../lib/config/integrationSettings.ts)), из env
 * читаться не должно: настройка живёт в базе и правится из интерфейса
 * (приоритет «база → env → умолчание»). Страж
 * `config.env-registry.guardrail` сверяет этот реестр с фактическими
 * чтениями `process.env.X` по `src/**`; страж `config.env-example.guardrail`
 * — с документацией `.env.example` (`У-134`).
 *
 * У каждой строки — причина, почему переменная не переезжает в базу:
 * - «инфраструктура» — подключения и секреты самого процесса: без них сервер
 *   не встаёт, читать их из базы нельзя (курица и яйцо) или бессмысленно;
 * - «среда» — выставляет платформа (Node/Next/CI), человек не задаёт;
 * - «тестовое» — dev/e2e-нобы, в проде не читаются;
 * - «edge» — route-флаги `FEATURE_*` из `FEATURE_PREFIXES`: edge-middleware
 *   снапшота базы не имеет (они перечислены не здесь, а выводятся из
 *   `FEATURE_FLAGS` — см. стражи).
 */
export const ENV_ONLY: Record<string, string> = {
  // --- инфраструктура: база, очереди, ключи процесса ---
  DATABASE_URL: 'инфраструктура: строка подключения Postgres (читает Prisma из schema.prisma)',
  REDIS_URL: 'инфраструктура: Redis для BullMQ',
  JWT_SECRET: 'инфраструктура: подпись сессионных JWT',
  APP_ENCRYPTION_KEY: 'инфраструктура: мастер-ключ шифрования секретов в БД (курица и яйцо)',
  APP_URL: 'инфраструктура: базовый адрес кабинета (ссылки в письмах, issuer моста)',
  HEALTH_TOKEN: 'инфраструктура: bearer readiness-пробы /api/health',

  // --- объектное хранилище ---
  S3_ENDPOINT: 'инфраструктура: адрес S3-совместимого хранилища',
  S3_REGION: 'инфраструктура: регион S3',
  S3_ACCESS_KEY_ID: 'инфраструктура: ключ доступа S3',
  S3_SECRET_ACCESS_KEY: 'инфраструктура: секретный ключ S3',
  S3_BUCKET: 'инфраструктура: bucket документов',
  S3_FORCE_PATH_STYLE: 'инфраструктура: path-style адресация (MinIO)',

  // --- наблюдаемость ---
  SENTRY_DSN: 'инфраструктура: DSN Sentry (пусто = no-op)',
  SENTRY_ENVIRONMENT: 'инфраструктура: имя окружения в Sentry',
  LOG_LEVEL: 'инфраструктура: уровень логов pino',
  LOG_FORMAT: 'инфраструктура: транспорт логов (json|console)',

  // --- антивирус ---
  CLAMAV_HOST: 'инфраструктура: хост ClamAV (пусто = скан помечает clean)',
  CLAMAV_PORT: 'инфраструктура: порт ClamAV',
  CLAMAV_TIMEOUT_MS: 'инфраструктура: таймаут скана',

  // --- мост в СДО (student bridge) ---
  STUDENT_BRIDGE_JWT_SECRET: 'инфраструктура: подпись bridge-JWT',
  STUDENT_BRIDGE_SHARED_SECRET: 'инфраструктура: аутентификация СДО на обмене кода',
  STUDENT_BRIDGE_ISSUER: 'инфраструктура: issuer bridge-JWT (fallback APP_URL)',
  STUDENT_BRIDGE_TTL: 'инфраструктура: TTL bridge-JWT, сек',
  STUDENT_BRIDGE_CODE_TTL_SEC: 'инфраструктура: TTL одноразового кода, сек',
  STUDENT_BRIDGE_RATE_LIMIT_MAX: 'инфраструктура: rate-limit обмена кода',
  STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS: 'инфраструктура: окно rate-limit, мс',
  STUDENT_REDIRECT_URL: 'инфраструктура: адрес СДО для кнопки «Кабинет слушателя»',
  STUDENT_REDIRECT_ALLOWED_DOMAINS: 'инфраструктура: allow-list доменов редиректа',
  STUDENT_PORTAL_URL: 'инфраструктура: легаси-алиас STUDENT_REDIRECT_URL (deprecated)',
  STUDENT_PORTAL_ALLOWED_HOSTS:
    'инфраструктура: легаси-алиас STUDENT_REDIRECT_ALLOWED_DOMAINS (deprecated)',

  // --- документы ---
  DOCUMENT_MAX_FILE_SIZE_MB: 'инфраструктура: предел загрузки файла, МБ',
  DOCUMENT_SIGNED_URL_TTL_SEC: 'инфраструктура: TTL presigned-ссылок скачивания',

  // --- воркер ---
  ENABLE_SYNC_CRON: 'инфраструктура: регистрация cron-задач воркера (hot-standby без него)',
  WORKER_SHUTDOWN_TIMEOUT_MS: 'инфраструктура: грейс graceful shutdown воркера',
  WORKER_HEARTBEAT_FILE: 'инфраструктура: файл heartbeat для liveness-пробы воркера',
  BACKFILL_BATCH: 'инфраструктура: размер батча scan-backfill свипа',

  // --- среда: выставляет платформа, не человек ---
  NODE_ENV: 'среда: production/development/test, выставляет Node/Next',
  NEXT_RUNTIME: 'среда: nodejs/edge, выставляет Next',

  // --- демо и dev-нобы ---
  SHOW_DEMO_LOGINS: 'инфраструктура: блок демо-логинов на /login (только dev/staging)',
  FAKE_INBOUND_EMAIL: 'тестовое: сценарий fake-адаптера входящей почты',
  FAKE_MANGO_STATS: 'тестовое: сценарий fake-адаптера статистики Mango',
  FAKE_MANGO_RECORDING: 'тестовое: сценарий fake-адаптера записей Mango',
  FAKE_ONEC_FAILURE_RATE: 'тестовое: доля отказов fake-адаптера 1С',
  FAKE_ONEC_LATENCY_MS: 'тестовое: задержка fake-адаптера 1С',
  FAKE_ONEC_MALFORMED_RATE: 'тестовое: доля битых записей fake-адаптера 1С',

  // --- e2e (playwright auth.setup) ---
  E2E_ADMIN_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_ADMIN_PASSWORD: 'тестовое: учётка e2e-прогона',
  E2E_LEADER_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_LEADER_PASSWORD: 'тестовое: учётка e2e-прогона',
  E2E_MANAGER_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_MANAGER_PASSWORD: 'тестовое: учётка e2e-прогона',
  E2E_ORG_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_ORG_PASSWORD: 'тестовое: учётка e2e-прогона',
  E2E_PARTNER_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_PARTNER_PASSWORD: 'тестовое: учётка e2e-прогона',
  E2E_STUDENT_EMAIL: 'тестовое: учётка e2e-прогона',
  E2E_STUDENT_PASSWORD: 'тестовое: учётка e2e-прогона',
};

/**
 * Переменные инструментов ВНЕ `src/**` (скрипты, mock-сервер 1С, Prisma) —
 * код кабинета их не читает, но `.env.example` обязан их документировать,
 * поэтому обратная сверка стража `У-134` знает их поимённо.
 */
export const TOOL_ONLY: Record<string, string> = {
  DIRECT_URL: 'prisma: прямое подключение мимо пула (migrate)',
  APP_DOMAIN: 'docker-compose.prod.yml: домен для Caddy (TLS-сертификат)',
  ADMIN_EMAIL: 'скрипт db:create-admin',
  ADMIN_PASSWORD: 'скрипт db:create-admin',
  ADMIN_NAME: 'скрипт db:create-admin',
  ADMIN_COMPANY: 'скрипт db:create-admin',
  MOCK1C_PORT: 'mock-сервер 1С (npm run mock:1c)',
  MOCK1C_TOKEN: 'mock-сервер 1С',
  MOCK1C_ENVELOPE: 'mock-сервер 1С',
  MOCK1C_STATUS_DIALECT: 'mock-сервер 1С',
  MOCK1C_DATETIME: 'mock-сервер 1С',
  MOCK1C_PAGE_SIZE: 'mock-сервер 1С',
  MOCK1C_MALFORMED_RATE: 'mock-сервер 1С',
  MOCK1C_DUPLICATES: 'mock-сервер 1С',
  MOCK1C_FAIL_MODE: 'mock-сервер 1С',
  MOCK1C_LATENCY_MS: 'mock-сервер 1С',
  MOCK1C_PUSH_FAIL_RATE: 'mock-сервер 1С',
};
