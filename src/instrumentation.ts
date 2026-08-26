/**
 * Next 15 instrumentation hook: инициализация Sentry для server (nodejs) и
 * edge (middleware) runtime + проброс ошибок запросов (`onRequestError`
 * покрывает route-handlers, включая webhook-роуты, и рендер серверных
 * компонентов).
 *
 * Контракт no-op: без SENTRY_DSN ни init, ни captureRequestError не зовутся —
 * локальная разработка и тесты не шумят и не ходят в сеть. SDK импортируется
 * динамически ТОЛЬКО при заданном DSN (холодный старт без Sentry не платит
 * за его загрузку).
 *
 * Клиентский Sentry намеренно не подключён (ТЗ §16: server/edge/worker/webhook).
 * Worker BullMQ — отдельный процесс, его init в src/worker/index.ts.
 */
import { scrubSentryEvent } from '@/lib/logging/scrub';
import { assertEnvOnBoot } from '@/lib/env';

/**
 * Прайм снапшота feature-флагов на старте процесса (`У-133`, дефект `Д-37`).
 *
 * Снапшот заполнялся только внутри `getSession()`. До первого входа в кабинет
 * его не было, а `api/auth/login` и `api/auth/2fa/*` читают флаг `staff_2fa`
 * ДО всякой сессии — то есть на холодном процессе флаг, включённый в
 * интерфейсе, не действовал, пока кто-нибудь не залогинится. Замкнутый круг:
 * чтобы 2FA включилась, нужно войти; чтобы войти по новым правилам, нужна
 * включённая 2FA.
 *
 * Fail-open сохраняется: любая ошибка базы логируется внутри `prime` и
 * оставляет читателей на переменных окружения. Импорт динамический — на
 * edge-runtime Prisma не грузится.
 */
async function primeFeatureFlagsOnBoot(): Promise<void> {
  try {
    const [{ prisma }, { primeFeatureFlagCache }] = await Promise.all([
      import('@/lib/db/prisma'),
      import('@/lib/config/featureFlagStore'),
    ]);
    await primeFeatureFlagCache(prisma);
  } catch {
    // База может быть ещё не поднята — это не повод не стартовать.
    // Первый же `getSession()` или запрос логина повторит прайм.
  }
}

export async function register(): Promise<void> {
  const runtime = process.env.NEXT_RUNTIME;
  // R0.2 fail-fast: production-сервер не поднимается с пустыми/плейсхолдерными
  // секретами (throw до какой-либо инициализации). Только nodejs-runtime:
  // edge-инстанс middleware не видит полного серверного окружения. Вне
  // production assertEnvOnBoot — no-op.
  if (runtime === 'nodejs') {
    assertEnvOnBoot();
    await primeFeatureFlagsOnBoot();
  }
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (runtime !== 'nodejs' && runtime !== 'edge') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    // `||`, не `??`: пустая строка в env означает «не задано»
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    // Только ошибки: перфоманс-трейсинг не входит в скоуп observability-PR
    tracesSampleRate: 0,
    // 152-ФЗ: не отправлять ip/cookies/user автоматически…
    sendDefaultPii: false,
    // …и вычищать ПДн/секреты из того, что всё же попало в событие
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

type CaptureRequestErrorArgs = Parameters<typeof import('@sentry/nextjs').captureRequestError>;

export async function onRequestError(...args: CaptureRequestErrorArgs): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
