import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto
} from './dto';
import type { ExecutionStatus, FinancialStatus, DocumentType } from '@prisma/client';

export type OrgUpsertInput = {
  externalId: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  partnerExternalId: string | null;
  updatedAt: Date;
};

export function mapOrgDto(dto: OneCOrgDto): OrgUpsertInput {
  return {
    externalId: dto.externalId,
    name: dto.name,
    inn: dto.inn ?? null,
    kpp: dto.kpp ?? null,
    partnerExternalId: dto.partnerExternalId ?? null,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type OrderUpsertInput = {
  externalId: string;
  orderNumber: string | null;
  title: string;
  organizationExternalId: string | null;
  organizationInn: string | null;
  totalAmount: number;
  paidAmount: number;
  paidAt: Date | null;
  contractSignedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  vatIncluded: boolean;
  vatRate: number | null;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  productMix: string[];
  updatedAt: Date;
};

export function mapOrderDto(dto: OneCOrderDto): OrderUpsertInput {
  return {
    externalId: dto.externalId,
    orderNumber: dto.orderNumber ?? null,
    title: dto.title,
    organizationExternalId: dto.organizationExternalId ?? null,
    organizationInn: dto.organizationInn ?? null,
    totalAmount: dto.totalAmount,
    paidAmount: dto.paidAmount,
    paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
    contractSignedAt: dto.contractSignedAt ? new Date(dto.contractSignedAt) : null,
    completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
    closedAt: dto.closedAt ? new Date(dto.closedAt) : null,
    vatIncluded: dto.vatIncluded,
    vatRate: dto.vatRate ?? null,
    executionStatus: dto.executionStatus as ExecutionStatus,
    financialStatus: dto.financialStatus as FinancialStatus,
    productMix: dto.productMix,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type PaymentUpsertInput = {
  externalId: string;
  orderExternalId: string | null;
  organizationExternalId: string | null;
  organizationInn: string | null;
  amount: number;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  updatedAt: Date;
};

export function mapPaymentDto(dto: OneCPaymentDto): PaymentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId ?? null,
    organizationExternalId: dto.organizationExternalId ?? null,
    organizationInn: dto.organizationInn ?? null,
    amount: dto.amount,
    paidAt: new Date(dto.paidAt),
    method: dto.method ?? null,
    isRefund: dto.isRefund,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type DocumentUpsertInput = {
  externalId: string;
  orderExternalId: string;
  type: DocumentType;
  name: string;
  mimeType: string;
  size: number;
  signedAt: Date | null;
  downloadUrl: string;
  updatedAt: Date;
};

export function mapDocumentDto(dto: OneCDocumentDto): DocumentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId,
    type: dto.type as DocumentType,
    name: dto.name,
    mimeType: dto.mimeType,
    size: dto.size,
    signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
    downloadUrl: dto.downloadUrl,
    updatedAt: new Date(dto.updatedAt)
  };
}
