import { Queue, type QueueOptions } from 'bullmq';
import { getRedisConnection } from './connection';

export const QUEUE_NAMES = [
  'oneCSync.pullOrders',
  'oneCSync.pullPayments',
  'oneCSync.pullDocuments',
  'oneCSync.pullOrganizations',
  'oneCSync.pushLead',
  'oneCSync.reconcile',
  'docs.generateCommissionPdf',
  'docs.generateCommissionXlsx',
  'docs.calculateMonthlyCommissions',
  'docs.scanDocument',
  'notifications.dispatch',
  'emails.send',
  'monitoring.evaluateAlerts',
  'notifications.certificateExpiry'
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const defaultJobOpts: QueueOptions['defaultJobOptions'] = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: defaultJobOpts
  });
  queues.set(name, queue);
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}
