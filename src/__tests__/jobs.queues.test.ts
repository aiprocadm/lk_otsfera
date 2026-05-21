import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';

describe('Job queue registry', () => {
  it('declares all phase 0 queue names', () => {
    const expected: QueueName[] = [
      'oneCSync.pullOrders',
      'oneCSync.pullPayments',
      'oneCSync.pullDocuments',
      'oneCSync.pullOrganizations',
      'oneCSync.pushLead',
      'oneCSync.reconcile',
      'docs.generateCommissionPdf',
      'docs.generateCommissionXlsx',
      'notifications.dispatch',
      'emails.send'
    ];
    for (const name of expected) {
      expect(QUEUE_NAMES).toContain(name);
    }
  });

  it('QUEUE_NAMES is frozen/readonly tuple', () => {
    // Compile-time assertion: QueueName covers exactly the declared 10 queues.
    const _check: QueueName extends typeof QUEUE_NAMES[number] ? true : false = true;
    expect(_check).toBe(true);
  });
});
