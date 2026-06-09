import { it, expect } from 'vitest';
import { mapPaymentRow } from '@/lib/services/import/payment-mapper';

it('maps a payment file row to an org-level upsert input', () => {
  const out = mapPaymentRow({ externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: 'wire', isRefund: false, note: 'аванс' }, 'org-1');
  expect(out).toMatchObject({ externalId: 'PP-1', organizationId: 'org-1', orderId: null, amount: 1000, method: 'wire', isRefund: false, note: 'аванс' });
  expect(out.paidAt instanceof Date).toBe(true);
});
