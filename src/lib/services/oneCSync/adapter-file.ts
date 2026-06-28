import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor,
} from './dto';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { translateFinancialStatus } from './translate';

const EPOCH = new Date(0).toISOString();

type FinStatus = OneCOrderDto['financialStatus'];
type ExecStatus = OneCOrderDto['executionStatus'];

function deriveFinStatus(total: number, paid: number, isRefund: boolean): FinStatus {
  /* v8 ignore next -- isRefund is always false at call sites in pullOrders; function signature preserved for future use */
  if (isRefund) return 'refunded';
  if (total <= 0) return 'not_billed';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'billed';
}

type RawOrder = {
  externalId: string;
  orderNumber: string | null;
  orgInn: string;
  totalAmount: number;
  paidAmount: number;
  financialStatusRaw?: string | null;
};

type RawPay = {
  externalId: string;
  orgInn: string;
  amount: number;
  paidAt: string;
  method: string | null;
  purpose: string | null;
  vatAmount: number | null;
  paymentOrderNumber: string | null;
  orderRef?: string | null;
};

export class FileOneCAdapter implements OneCAdapter {
  constructor(private readonly buffer: Buffer | ArrayBuffer) {}

  private parsed?: ReturnType<typeof parseWorkbook>;
  private sheets() { return (this.parsed ??= parseWorkbook(this.buffer)); }

  // Excel import only ATTACHES to existing orgs (resolved by INN); it never creates orgs or documents.
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    void cursor;
    return [];
  }

  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    void cursor;
    return [];
  }

  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    void cursor;
    const { orders } = await this.sheets();
    const result: OneCOrderDto[] = [];
    for (const raw of orders as RawOrder[]) {
      if (!raw?.externalId || !raw?.orgInn) continue;
      const total = Number(raw.totalAmount) || 0;
      const paid = Number(raw.paidAmount) || 0;
      let fin: FinStatus = deriveFinStatus(total, paid, false);
      if (raw.financialStatusRaw) {
        const t = translateFinancialStatus(raw.financialStatusRaw);
        if (t.ok) fin = t.value;
      }
      const executionStatus: ExecStatus = 'pending';
      result.push({
        externalId: raw.externalId,
        orderNumber: raw.orderNumber ?? undefined,
        title: raw.orderNumber ?? raw.externalId,
        organizationInn: raw.orgInn,
        totalAmount: total,
        paidAmount: paid,
        vatIncluded: true,
        executionStatus,
        financialStatus: fin,
        productMix: [],
        updatedAt: EPOCH,
      });
    }
    return result;
  }

  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    void cursor;
    const { payments } = await this.sheets();
    const result: OneCPaymentDto[] = [];
    for (const raw of payments as RawPay[]) {
      if (!raw?.externalId || !raw?.orgInn) continue;
      const isRefund = /возврат/i.test(raw.method ?? '') || Number(raw.amount) < 0;
      const base = {
        externalId: raw.externalId,
        amount: Number(raw.amount) || 0,
        paidAt: raw.paidAt,
        method: raw.method ?? undefined,
        purpose: raw.purpose ?? undefined,
        paymentOrderNumber: raw.paymentOrderNumber ?? undefined,
        vatAmount: raw.vatAmount == null ? undefined : Number(raw.vatAmount),
        isRefund,
        updatedAt: EPOCH,
      };
      if (raw.orderRef) {
        result.push({ ...base, orderExternalId: raw.orderRef });
      } else {
        result.push({ ...base, organizationInn: raw.orgInn });
      }
    }
    return result;
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    void payload;
    throw new Error('FileOneCAdapter is read-only');
  }
}
