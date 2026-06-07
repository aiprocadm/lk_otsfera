import { Worker, type Processor } from 'bullmq';
import { getRedisConnection, closeRedisConnection } from '@/lib/jobs/connection';
import { closeAllQueues, getQueue, type QueueName } from '@/lib/jobs/queues';
import { registerSyncSchedules, registerCommissionSchedules, registerAlertSchedules, loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { prisma } from '@/lib/db/prisma';
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
import type { PushLeadJobPayload } from '@/lib/jobs/types';

const workers: Worker[] = [];

function startWorker<T = unknown>(queueName: QueueName, processor: Processor<T>): Worker {
  const worker = new Worker(queueName, processor, {
    connection: getRedisConnection(),
    autorun: true
  });
  worker.on('completed', (job) => {
    console.log(`[worker] ${queueName} completed`, { id: job.id });
  });
  worker.on('failed', (job, err) => {
    console.error(`[worker] ${queueName} failed`, { id: job?.id, error: err.message });
  });
  workers.push(worker);
  return worker;
}

async function main() {
  console.log('[worker] starting...');
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
        }).catch((e) => console.error('[worker] notifyPushLeadFinalFailure failed', e));
      }
    }
  });

  startWorker('docs.generateCommissionPdf', generateCommissionPdfProcessor as Processor);
  startWorker('docs.generateCommissionXlsx', generateCommissionXlsxProcessor as Processor);
  startWorker('docs.calculateMonthlyCommissions', calculateMonthlyCommissionsProcessor as Processor);
  startWorker('docs.scanDocument', scanDocumentProcessor as Processor);
  startWorker('monitoring.evaluateAlerts', evaluateAlertsProcessor as Processor);

  if (process.env.ENABLE_SYNC_CRON === '1') {
    const pausedIds = await loadPausedSchedulerIds(prisma);
    const syncSchedules = await registerSyncSchedules(getQueue, pausedIds);
    const commissionSchedules = await registerCommissionSchedules();
    const alertSchedules = await registerAlertSchedules();
    for (const r of [...syncSchedules, ...commissionSchedules, ...alertSchedules]) {
      console.log('[worker] schedule registered', {
        schedulerId: r.schedulerId,
        queue: r.queueName,
        pattern: r.pattern,
        tz: r.tz
      });
    }
  } else {
    console.log('[worker] ENABLE_SYNC_CRON!=1 — cron schedules NOT registered (hot standby mode)');
  }

  console.log('[worker] ready, listening on queues');
}

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await Promise.all(workers.map((w) => w.close()));
  await closeAllQueues();
  await closeRedisConnection();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[worker] fatal error', err);
  process.exit(1);
});
