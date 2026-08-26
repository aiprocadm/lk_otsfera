import { Worker, type Processor } from 'bullmq';
import * as Sentry from '@sentry/node';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertEnvOnBoot } from '@/lib/env';
import { runBackfill } from '@/lib/services/scan/backfill';
import { log } from '@/lib/logging';
import { scrubSentryEvent } from '@/lib/logging/scrub';
import { getRedisConnection, closeRedisConnection } from '@/lib/jobs/connection';
import { closeAllQueues, getQueue, type QueueName } from '@/lib/jobs/queues';
import {
  registerSyncSchedules,
  registerCommissionSchedules,
  registerAlertSchedules,
  registerCertExpirySchedules,
  registerCalendarReminderSchedules,
  registerTaskDueSoonSchedules,
  registerSlaEscalationSchedules,
  loadPausedSchedulerIds,
} from '@/lib/jobs/scheduling';
import { prisma } from '@/lib/db/prisma';
import { primeFeatureFlagCache } from '@/lib/config/featureFlagStore';
import { getSchedulePatterns } from '@/lib/services/admin/syncSchedules';
import type { PushLeadJobPayload } from '@/lib/jobs/types';
import { toBullProcessor } from './to-bull-processor';
import { syncOrdersProcessor } from './processors/sync-orders';
import { syncPaymentsProcessor } from './processors/sync-payments';
import { syncDocumentsProcessor } from './processors/sync-documents';
import { syncOrganizationsProcessor } from './processors/sync-organizations';
import { syncReconcileProcessor } from './processors/sync-reconcile';
import { pushLeadProcessor, notifyPushLeadFinalFailure } from './processors/push-lead';
import { generateCommissionPdfProcessor } from './processors/generate-commission-pdf';
import { generateCommissionXlsxProcessor } from './processors/generate-commission-xlsx';
import { calculateMonthlyCommissionsProcessor } from './processors/calculate-monthly-commissions';
import { scanDocumentProcessor } from './processors/scan-document';
import { evaluateAlertsProcessor } from './processors/evaluate-alerts';
import { certificateExpiryProcessor } from './processors/certificate-expiry';
import { calendarReminderProcessor } from './processors/calendar-reminder';
import { taskDueSoonProcessor } from './processors/task-due-soon';
import { slaEscalationProcessor } from './processors/sla-escalation';
import { dispatchNotificationProcessor } from './processors/dispatch-notification';
import { pollInboundEmailProcessor } from './processors/poll-inbound-email';
import { mangoRecordingProcessor } from './processors/mango-recording';
import { mangoBackfillProcessor } from './processors/mango-backfill';

// No-op без DSN (локально/в тестах Sentry не шумит и не ходит в сеть).
// beforeSend-скраббер — общий с Next-инициализацией (152-ФЗ: без ПДн/секретов).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

const workers: Worker[] = [];

function startWorker<T = unknown>(queueName: QueueName, processor: Processor<T>): Worker {
  // toBullProcessor: forward only `job`, so each processor's injected `db = prisma`
  // default survives (BullMQ would otherwise pass its token string into that slot).
  const worker = new Worker(queueName, toBullProcessor(processor), {
    connection: getRedisConnection(),
    autorun: true,
  });
  worker.on('completed', (job) => {
    log.info(`[worker] ${queueName} completed`, { id: job.id });
  });
  worker.on('failed', (job, err) => {
    log.error(`[worker] ${queueName} failed`, { id: job?.id, error: err.message });
    // Терминальная неудача (retries исчерпаны) — сигнал в Sentry; промежуточные
    // ретраи не шлём, чтобы не дублировать одно падение до 5 раз.
    if ((job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1)) {
      Sentry.captureException(err, {
        tags: { queue: queueName },
        extra: { jobId: job?.id, attemptsMade: job?.attemptsMade },
      });
    }
  });
  // R1.4: run-loop ошибки BullMQ (например, обрыв Redis между джобами) —
  // EventEmitter без слушателя 'error' уронил бы процесс uncaughtException'ом.
  worker.on('error', (err) => {
    log.error(`[worker] ${queueName} runtime error`, { error: err.message });
    Sentry.captureException(err, { tags: { queue: queueName, kind: 'worker-error' } });
  });
  workers.push(worker);
  return worker;
}

/**
 * R1.1: honest-liveness воркера. Раз в 60с трогаем heartbeat-файл; compose
 * healthcheck воркера проверяет его свежесть (<3 мин). Ошибка записи не должна
 * ронять воркер — только лог (протухший файл сам по себе просигналит unhealthy).
 */
function startHeartbeat(): void {
  const file = process.env.WORKER_HEARTBEAT_FILE ?? join(tmpdir(), 'worker-heartbeat');
  const touch = () => {
    try {
      writeFileSync(file, String(Date.now()));
    } catch (e) {
      log.warn('[worker] heartbeat write failed', {
        file,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  touch();
  setInterval(touch, 60_000).unref();
}

/**
 * R1.4: scan-backfill sweep. runBackfill — страховка, на которую ссылаются
 * комментарии scan-document («backfill sweep подберёт»), но которую до сих пор
 * никто не вызывал в проде: документ с упавшим enqueue навсегда застревал в
 * scanStatus=pending. Час — компромисс между скоростью подбора и нагрузкой;
 * сам свип идемпотентен (WHERE pending пропускает обработанные строки).
 */
function startScanBackfillSweep(): void {
  const sweep = async () => {
    try {
      // Явный queue-аргумент: default-параметр runBackfill зовёт getQueue()
      // синхронно и бросил бы без REDIS_URL прямо из планировщика.
      const result = await runBackfill(prisma, getQueue('docs.scanDocument'));
      if (result.enqueued > 0) log.info('[worker] scan-backfill sweep enqueued', result);
    } catch (e) {
      log.error('[worker] scan-backfill sweep failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  void sweep();
  setInterval(() => void sweep(), 60 * 60 * 1000).unref();
}

async function main() {
  // R0.2 fail-fast: воркер не стартует с невалидным production-окружением
  // (no-op вне production). Ошибка уйдёт в main().catch → Sentry + exit(1).
  assertEnvOnBoot();
  // `У-133`: снапшот флагов до первого джоба — процессоры читают флаги
  // синхронно и своей сессии не имеют, поэтому праймить некому.
  await primeFeatureFlagCache(prisma);
  log.info('[worker] starting...');
  startWorker('oneCSync.pullOrganizations', syncOrganizationsProcessor as Processor);
  startWorker('oneCSync.pullOrders', syncOrdersProcessor as Processor);
  startWorker('oneCSync.pullPayments', syncPaymentsProcessor as Processor);
  startWorker('oneCSync.pullDocuments', syncDocumentsProcessor as Processor);
  startWorker('oneCSync.reconcile', syncReconcileProcessor as Processor);

  const pushLeadWorker = startWorker('oneCSync.pushLead', pushLeadProcessor as Processor);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- BullMQ допускает async-слушатель 'failed'; ошибки обрабатываются внутри
  pushLeadWorker.on('failed', async (job, err) => {
    if (!job) return;
    if ((job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 1)) {
      const data = job.data as PushLeadJobPayload | undefined;
      if (data?.leadId) {
        await notifyPushLeadFinalFailure(prisma, {
          leadId: data.leadId,
          errorMessage: err.message,
        }).catch((e) => log.error('[worker] notifyPushLeadFinalFailure failed', e));
      }
    }
  });

  startWorker('docs.generateCommissionPdf', generateCommissionPdfProcessor as Processor);
  startWorker('docs.generateCommissionXlsx', generateCommissionXlsxProcessor as Processor);
  startWorker(
    'docs.calculateMonthlyCommissions',
    calculateMonthlyCommissionsProcessor as Processor
  );
  startWorker('docs.scanDocument', scanDocumentProcessor as Processor);
  startWorker('monitoring.evaluateAlerts', evaluateAlertsProcessor as Processor);
  startWorker('notifications.certificateExpiry', certificateExpiryProcessor as Processor);
  startWorker('notifications.calendarReminder', calendarReminderProcessor as Processor);
  startWorker('notifications.taskDueSoon', taskDueSoonProcessor as Processor);
  startWorker('monitoring.slaEscalation', slaEscalationProcessor as Processor);
  startWorker('notifications.dispatch', dispatchNotificationProcessor as Processor);
  startWorker('inbound.email.poll', pollInboundEmailProcessor as Processor);
  startWorker('telephony.mango.recording', mangoRecordingProcessor as Processor);
  startWorker('telephony.mango.backfill', mangoBackfillProcessor as Processor);

  if (process.env.ENABLE_SYNC_CRON === '1') {
    const pausedIds = await loadPausedSchedulerIds(prisma);
    // `У-125`: расписания читаются из базы — правка в интерфейсе доезжает до
    // воркера при следующей регистрации, без выкладки и правки кода.
    const patterns = await getSchedulePatterns(prisma);
    const syncSchedules = await registerSyncSchedules(getQueue, pausedIds, patterns);
    const commissionSchedules = await registerCommissionSchedules();
    const alertSchedules = await registerAlertSchedules();
    const certExpirySchedules = await registerCertExpirySchedules();
    const calendarReminderSchedules = await registerCalendarReminderSchedules();
    const taskDueSoonSchedules = await registerTaskDueSoonSchedules();
    const slaEscalationSchedules = await registerSlaEscalationSchedules();
    for (const r of [
      ...syncSchedules,
      ...commissionSchedules,
      ...alertSchedules,
      ...certExpirySchedules,
      ...calendarReminderSchedules,
      ...taskDueSoonSchedules,
      ...slaEscalationSchedules,
    ]) {
      log.info('[worker] schedule registered', {
        schedulerId: r.schedulerId,
        queue: r.queueName,
        pattern: r.pattern,
        tz: r.tz,
      });
    }
  } else {
    log.info('[worker] ENABLE_SYNC_CRON!=1 — cron schedules NOT registered (hot standby mode)');
  }

  startHeartbeat();
  if (process.env.ENABLE_SYNC_CRON === '1') {
    startScanBackfillSweep();
  }

  log.info('[worker] ready, listening on queues');
}

// Грейс на закрытие: BullMQ w.close() ждёт завершения активного job'а — если
// job завис, SIGTERM раньше блокировался навсегда (до SIGKILL оркестратора).
// 25с по умолчанию: меньше стандартных 30с grace-периода Docker/K8s, чтобы
// успеть выйти самим и залогировать причину.
const SHUTDOWN_TIMEOUT_MS = (() => {
  const raw = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
})();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; // повторный SIGTERM/SIGINT во время закрытия
  shuttingDown = true;
  log.info(`[worker] received ${signal}, shutting down...`);
  const forceExit = setTimeout(() => {
    log.error('[worker] graceful shutdown timed out — forcing exit', {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  await Promise.all(workers.map((w) => w.close()));
  await closeAllQueues();
  await closeRedisConnection();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// R1.4: process-level страховки. unhandledRejection — лог + Sentry, процесс
// живёт (BullMQ-воркеры независимы, а дефолт Node уронил бы процесс без
// репорта). uncaughtException — состояние процесса неизвестно: репортим,
// флашим и выходим 1 под restart:unless-stopped.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error('[worker] unhandled rejection', { error: err.message });
  Sentry.captureException(err, { tags: { kind: 'unhandled-rejection' } });
});
process.on('uncaughtException', (err) => {
  log.error('[worker] uncaught exception — exiting', { error: err.message });
  Sentry.captureException(err, { tags: { kind: 'uncaught-exception' } });
  void Sentry.flush(2000)
    .catch(() => {})
    .finally(() => process.exit(1));
});

main().catch(async (err) => {
  log.error('[worker] fatal error', err);
  Sentry.captureException(err, { tags: { fatal: 'worker-bootstrap' } });
  // flush(2s): дать транспорту отправить событие до выхода процесса; без DSN — no-op
  await Sentry.flush(2000).catch(() => {});
  process.exit(1);
});
