import { Worker, type Processor } from 'bullmq';
import { getRedisConnection, closeRedisConnection } from '@/lib/jobs/connection';
import { closeAllQueues, type QueueName } from '@/lib/jobs/queues';
import { syncOrdersProcessor } from './processors/sync-orders';

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
  startWorker('oneCSync.pullOrders', syncOrdersProcessor as Processor);
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
