import { Queue, type QueueOptions } from 'bullmq';
import { getRedisConnection } from './connection';

export const QUEUE_NAMES = [
  'oneCSync.pullOrders',
  'oneCSync.pullPayments',
  'oneCSync.pullDocuments',
  'oneCSync.pullOrganizations',
  'oneCSync.pushLead',
  // Этап 8 (`У-168`): выгрузка одного документа в 1С. Задача — `{ documentId }`
  // без собственного `jobId`: BullMQ молча отбрасывает задачу, чей `jobId` ещё
  // лежит среди завершённых, и «Повторить» после успеха или отказа переставало
  // бы работать. От двойной доставки защищает сравнение версий в процессоре.
  'oneCSync.pushDocument',
  'oneCSync.reconcile',
  'docs.generateCommissionPdf',
  'docs.generateCommissionXlsx',
  'docs.calculateMonthlyCommissions',
  'docs.scanDocument',
  // `У-164` (этап 7): ежедневное истечение срока коммерческих предложений.
  'docs.expireProposals',
  'notifications.dispatch',
  'monitoring.evaluateAlerts',
  'monitoring.slaEscalation',
  'notifications.certificateExpiry',
  'notifications.calendarReminder',
  'notifications.taskDueSoon',
  'inbound.email.poll',
  'telephony.mango.recording',
  'telephony.mango.backfill',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const defaultJobOpts: NonNullable<QueueOptions['defaultJobOptions']> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: defaultJobOpts,
  });
  queues.set(name, queue);
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}
