import type {
  ExecutionStatus,
  FinancialStatus,
  DocumentDirection,
  DocumentType,
} from '@prisma/client';
import type { OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto } from './dto';

/**
 * `У-171` (`Д-23`): реквизиты контрагента, которые 1С может прислать. Ключи
 * совпадают с колонками `Organization` — writer кладёт их в `update`/`create`
 * как есть. `inn` и `kpp` тоже здесь: для правила «пустое не затирает» они
 * ничем не отличаются от адреса.
 */
export const ORG_REQUISITE_KEYS = [
  'inn',
  'kpp',
  'legalName',
  'ogrn',
  'legalAddress',
  'bankName',
  'bankAccount',
  'corrAccount',
  'bic',
  'signerName',
  'signerPosition',
  'signerBasis',
] as const;

export type OrgRequisites = { [K in (typeof ORG_REQUISITE_KEYS)[number]]: string | null };

export type OrgUpsertInput = OrgRequisites & {
  externalId: string;
  name: string;
  partnerExternalId: string | null;
  updatedAt: Date;
};

// `''` и пробелы из 1С — это «поля нет», а не значение (`У-171`).
const text = (v: string | undefined): string | null => v?.trim() || null;

export function mapOrgDto(dto: OneCOrgDto): OrgUpsertInput {
  return {
    externalId: dto.externalId,
    name: dto.name,
    inn: text(dto.inn),
    kpp: text(dto.kpp),
    // `Д-23`: раньше legalName из схемы сюда не доезжал — и терялся.
    legalName: text(dto.legalName),
    ogrn: text(dto.ogrn),
    legalAddress: text(dto.legalAddress),
    bankName: text(dto.bankName),
    bankAccount: text(dto.bankAccount),
    corrAccount: text(dto.corrAccount),
    bic: text(dto.bic),
    signerName: text(dto.signerName),
    signerPosition: text(dto.signerPosition),
    signerBasis: text(dto.signerBasis),
    partnerExternalId: dto.partnerExternalId ?? null,
    updatedAt: new Date(dto.updatedAt),
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
    updatedAt: new Date(dto.updatedAt),
  };
}

export type PaymentUpsertInput = {
  externalId: string;
  orderExternalId: string | null;
  /** `У-88`: локальный адрес организации (без ИНН/1С-ключа), см. OneCPaymentDto. */
  organizationId: string | null;
  organizationExternalId: string | null;
  organizationInn: string | null;
  amount: number;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  purpose: string | null;
  paymentOrderNumber: string | null;
  vatAmount: number | null;
  updatedAt: Date;
};

export function mapPaymentDto(dto: OneCPaymentDto): PaymentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId ?? null,
    organizationId: dto.organizationId ?? null,
    organizationExternalId: dto.organizationExternalId ?? null,
    organizationInn: dto.organizationInn ?? null,
    amount: dto.amount,
    paidAt: new Date(dto.paidAt),
    method: dto.method ?? null,
    isRefund: dto.isRefund,
    purpose: dto.purpose ?? null,
    paymentOrderNumber: dto.paymentOrderNumber ?? null,
    vatAmount: dto.vatAmount ?? null,
    updatedAt: new Date(dto.updatedAt),
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
  /** `У-170`: направление и номер — из DTO, а не литералом writer'а. */
  direction: DocumentDirection;
  number: string | null;
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
    updatedAt: new Date(dto.updatedAt),
    direction: dto.direction,
    // Пустая строка из 1С — это «номера нет», а не номер «».
    number: dto.number?.trim() || null,
  };
}
