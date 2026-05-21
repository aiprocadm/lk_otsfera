export type OneCOrgDto = {
  externalId: string;
  name: string;
  legalName?: string;
  inn?: string;
  kpp?: string;
  partnerExternalId?: string;
  updatedAt: string;
};

export type OneCOrderDto = {
  externalId: string;
  orderNumber?: string;
  title: string;
  organizationExternalId: string;
  totalAmount: number;
  paidAmount: number;
  paidAt?: string;
  contractSignedAt?: string;
  completedAt?: string;
  closedAt?: string;
  vatIncluded: boolean;
  vatRate?: number;
  executionStatus: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'on_hold';
  financialStatus: 'not_billed' | 'billed' | 'partially_paid' | 'paid' | 'refunded';
  productMix: string[];
  updatedAt: string;
};

export type OneCPaymentDto = {
  externalId: string;
  orderExternalId: string;
  amount: number;
  paidAt: string;
  method?: string;
  isRefund: boolean;
  updatedAt: string;
};

export type OneCDocumentDto = {
  externalId: string;
  orderExternalId: string;
  type: 'contract' | 'extra_agreement' | 'invoice' | 'act' | 'waybill' | 'certificate' | 'report' | 'other';
  name: string;
  mimeType: string;
  size: number;
  signedAt?: string;
  downloadUrl: string;
  updatedAt: string;
};

export type OneCLeadPushPayload = {
  partnerExternalId?: string;
  partnerSlug?: string;
  cabinetLeadId: string;
  clientCompanyName: string;
  clientInn?: string;
  clientContactName: string;
  clientContactPhone?: string;
  clientContactEmail?: string;
  subject: string;
  estimatedAmount?: number;
  productType: string[];
  notes?: string;
};

export type OneCLeadPushResult = {
  acceptedAt: string;
  oneCRequestId?: string;
};

export type SyncCursor = {
  since?: string;
};
