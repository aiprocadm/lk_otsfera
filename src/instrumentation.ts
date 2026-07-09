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

export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const runtime = process.env.NEXT_RUNTIME;
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
    beforeSend: (event) => scrubSentryEvent(event)
  });
}

type CaptureRequestErrorArgs = Parameters<typeof import('@sentry/nextjs').captureRequestError>;

export async function onRequestError(...args: CaptureRequestErrorArgs): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
