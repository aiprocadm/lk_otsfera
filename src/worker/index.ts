import { Worker, type Processor } from 'bullmq';
import * as Sentry from '@sentry/node';
import { log } from '@/lib/logging';
import { scrubSentryEvent } from '@/lib/logging/scrub';
import { getRedisConnection, closeRedisConnection } from '@/lib/jobs/connection';
import { closeAllQueues, getQueue, type QueueName } from '@/lib/jobs/queues';
import { registerSyncSchedules, registerCommissionSchedules, registerAlertSchedules, registerCertExpirySchedules, loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { prisma } from '@/lib/db/prisma';
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
import { dispatchNotificationProcessor } from './processors/dispatch-notification';
import { pollInboundEmailProcessor } from './processors/poll-inbound-email';
import { mangoRecordingProcessor } from './processors/mango-recording';
import { mangoBackfillProcessor } from './processors/mango-backfill';
import type { PushLeadJobPayload } from '@/lib/jobs/types';

// No-op без DSN (локально/в тестах Sentry не шумит и не ходит в сеть).
// beforeSend-скраббер — общий с Next-инициализацией (152-ФЗ: без ПДн/секретов).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event)
  });
}

const workers: Worker[] = [];

function startWorker<T = unknown>(queueName: QueueName, processor: Processor<T>): Worker {
  // toBullProcessor: forward only `job`, so each processor's injected `db = prisma`
  // default survives (BullMQ would otherwise pass its token string into that slot).
  const worker = new Worker(queueName, toBullProcessor(processor), {
    connection: getRedisConnection(),
    autorun: true
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
        extra: { jobId: job?.id, attemptsMade: job?.attemptsMade }
      });
    }
  });
  workers.push(worker);
  return worker;
}

async function main() {
  log.info('[worker] starting...');
  startWorker('oneCSync.pullOrganizations', syncOrganizationsProcessor as Processor);
  startWorker('oneCSync.pullOrders', syncOrdersProcessor as Processor);
  startWorker('oneCSync.pullPayments', syncPaymentsProcessor as Processor);
  startWorker('oneCSync.pullDocuments', syncDocumentsProcessor as Processor);
  startWorker('oneCSync.reconcile', syncReconcileProcessor as Processor);

  const pushLeadWorker = startWorker(
    'oneCSync.pushLead',
    pushLeadProcessor as Processor
  );
  pushLeadWorker.on('failed', async (job, err) => {
    if (!job) return;
    if ((job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 1)) {
      const data = job.data as PushLeadJobPayload | undefined;
      if (data?.leadId) {
        await notifyPushLeadFinalFailure(prisma, {
          leadId: data.leadId,
          errorMessage: err.message
        }).catch((e) => log.error('[worker] notifyPushLeadFinalFailure failed', e));
      }
    }
  });

  startWorker('docs.generateCommissionPdf', generateCommissionPdfProcessor as Processor);
  startWorker('docs.generateCommissionXlsx', generateCommissionXlsxProcessor as Processor);
  startWorker('docs.calculateMonthlyCommissions', calculateMonthlyCommissionsProcessor as Processor);
  startWorker('docs.scanDocument', scanDocumentProcessor as Processor);
  startWorker('monitoring.evaluateAlerts', evaluateAlertsProcessor as Processor);
  startWorker('notifications.certificateExpiry', certificateExpiryProcessor as Processor);
  startWorker('notifications.dispatch', dispatchNotificationProcessor as Processor);
  startWorker('inbound.email.poll', pollInboundEmailProcessor as Processor);
  startWorker('telephony.mango.recording', mangoRecordingProcessor as Processor);
  startWorker('telephony.mango.backfill', mangoBackfillProcessor as Processor);

  if (process.env.ENABLE_SYNC_CRON === '1') {
    const pausedIds = await loadPausedSchedulerIds(prisma);
    const syncSchedules = await registerSyncSchedules(getQueue, pausedIds);
    const commissionSchedules = await registerCommissionSchedules();
    const alertSchedules = await registerAlertSchedules();
    const certExpirySchedules = await registerCertExpirySchedules();
    for (const r of [...syncSchedules, ...commissionSchedules, ...alertSchedules, ...certExpirySchedules]) {
      log.info('[worker] schedule registered', {
        schedulerId: r.schedulerId,
        queue: r.queueName,
        pattern: r.pattern,
        tz: r.tz
      });
    }
  } else {
    log.info('[worker] ENABLE_SYNC_CRON!=1 — cron schedules NOT registered (hot standby mode)');
  }

  log.info('[worker] ready, listening on queues');
}

async function shutdown(signal: string) {
  log.info(`[worker] received ${signal}, shutting down...`);
  await Promise.all(workers.map((w) => w.close()));
  await closeAllQueues();
  await closeRedisConnection();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async (err) => {
  log.error('[worker] fatal error', err);
  Sentry.captureException(err, { tags: { fatal: 'worker-bootstrap' } });
  // flush(2s): дать транспорту отправить событие до выхода процесса; без DSN — no-op
  await Sentry.flush(2000).catch(() => {});
  process.exit(1);
});
