// File-row DTOs (post-validation, pre-upsert)
export type OrgFileRow = { name: string; inn: string; partnerInn: string | null };
export type OrderFileRow = {
  externalId: string; orderNumber: string | null; orgInn: string;
  totalAmount: number; paidAmount: number;
};
export type PaymentFileRow = {
  externalId: string; orgInn: string; amount: number; paidAt: string;
  method: string | null; isRefund: boolean; note: string | null;
};

export type Sheet = 'orgs' | 'orders' | 'payments';
export type Quarantine = { sheet: Sheet; rowIndex: number; reason: string };

export type RowDecision =
  | { action: 'create' | 'update' }
  | { action: 'skip'; reason: string };

export type ImportCounts = {
  orgsCreated: number; orgsUpdated: number; orgsStandalone: number;
  ordersUpserted: number; paymentsUpserted: number;
};
export type SkipReport = {
  orgs: Quarantine[]; orders: Quarantine[]; payments: Quarantine[];
};
export type ImportPlan = {
  counts: ImportCounts;
  skipped: SkipReport;
  quarantine: Quarantine[];
};
