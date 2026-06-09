import type { PaymentFileRow } from './types';

export function mapPaymentRow(row: PaymentFileRow, organizationId: string) {
  return {
    externalId: row.externalId,
    organizationId,
    orderId: null as string | null,
    amount: row.amount,
    paidAt: new Date(row.paidAt),
    method: row.method,
    isRefund: row.isRefund,
    note: row.note,
  };
}
