import { describe, expect, it } from 'vitest';
import {
  ORG_REQUISITE_KEYS,
  mapOrgDto,
  mapOrderDto,
  mapPaymentDto,
  mapDocumentDto,
} from '@/lib/services/oneCSync/mappers';

describe('1C → Prisma mappers', () => {
  it('mapOrgDto produces Prisma upsert input shape', () => {
    const out = mapOrgDto({
      externalId: '1c-org-001',
      name: 'ООО Тест',
      legalName: 'Test LLC',
      inn: '770000',
      kpp: '770001',
      partnerExternalId: '1c-partner-001',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.externalId).toBe('1c-org-001');
    expect(out.name).toBe('ООО Тест');
    expect(out.inn).toBe('770000');
    expect(out.updatedAt).toBeInstanceOf(Date);
  });

  it('mapOrderDto carries enums and decimals as strings/numbers', () => {
    const out = mapOrderDto({
      externalId: '1c-order-1',
      orderNumber: 'N-1',
      title: 'T',
      organizationExternalId: '1c-org-001',
      totalAmount: 100,
      paidAmount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      vatIncluded: true,
      vatRate: 0.2,
      executionStatus: 'in_progress' as const,
      financialStatus: 'partially_paid' as const,
      productMix: ['training'],
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.externalId).toBe('1c-order-1');
    expect(out.executionStatus).toBe('in_progress');
    expect(out.financialStatus).toBe('partially_paid');
    expect(out.totalAmount).toBe(100);
    expect(out.productMix).toEqual(['training']);
  });

  it('mapPaymentDto preserves orderExternalId for later resolution', () => {
    const out = mapPaymentDto({
      externalId: 'p1',
      orderExternalId: 'o1',
      amount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.externalId).toBe('p1');
    expect(out.orderExternalId).toBe('o1');
    expect(out.organizationExternalId).toBeNull();
    expect(out.amount).toBe(50);
  });

  it('mapPaymentDto maps org-level payment (no order)', () => {
    const out = mapPaymentDto({
      externalId: 'p2',
      organizationExternalId: 'org1',
      amount: 200,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.externalId).toBe('p2');
    expect(out.orderExternalId).toBeNull();
    expect(out.organizationExternalId).toBe('org1');
    expect(out.amount).toBe(200);
  });

  it('mapDocumentDto preserves type as enum-compatible string', () => {
    const out = mapDocumentDto({
      externalId: 'd1',
      orderExternalId: 'o1',
      direction: 'incoming',
      type: 'act',
      name: 'Акт.pdf',
      mimeType: 'application/pdf',
      size: 100,
      downloadUrl: 'fake://d1',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.externalId).toBe('d1');
    expect(out.type).toBe('act');
  });

  it('mapOrderDto: null/undefined optional date fields become null', () => {
    const out = mapOrderDto({
      externalId: '1c-order-null-dates',
      title: 'T',
      totalAmount: 0,
      paidAmount: 0,
      vatIncluded: false,
      executionStatus: 'pending' as const,
      financialStatus: 'not_billed' as const,
      productMix: [],
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.orderNumber).toBeNull();
    expect(out.organizationExternalId).toBeNull();
    expect(out.organizationInn).toBeNull();
    expect(out.paidAt).toBeNull();
    expect(out.contractSignedAt).toBeNull();
    expect(out.completedAt).toBeNull();
    expect(out.closedAt).toBeNull();
    expect(out.vatRate).toBeNull();
  });

  it('mapPaymentDto: null optional fields become null', () => {
    const out = mapPaymentDto({
      externalId: 'p-null',
      amount: 100,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.orderExternalId).toBeNull();
    expect(out.organizationExternalId).toBeNull();
    expect(out.organizationInn).toBeNull();
    expect(out.method).toBeNull();
    expect(out.purpose).toBeNull();
    expect(out.paymentOrderNumber).toBeNull();
    expect(out.vatAmount).toBeNull();
  });

  it('mapPaymentDto: maps purpose/paymentOrderNumber/vatAmount when present', () => {
    const out = mapPaymentDto({
      externalId: 'p-full',
      orderExternalId: 'o1',
      amount: 200,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      purpose: 'Оплата по договору',
      paymentOrderNumber: 'ПП-007',
      vatAmount: 36,
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.purpose).toBe('Оплата по договору');
    expect(out.paymentOrderNumber).toBe('ПП-007');
    expect(out.vatAmount).toBe(36);
  });

  it('У-170: mapDocumentDto переносит direction; number обрезает, пустой — null', () => {
    const base = {
      externalId: 'd-dir',
      orderExternalId: 'o1',
      direction: 'outgoing' as const,
      type: 'contract' as const,
      name: 'f.pdf',
      mimeType: 'application/pdf',
      size: 1,
      downloadUrl: 'fake://x',
      updatedAt: '2026-05-01T00:00:00Z',
    };
    expect(mapDocumentDto({ ...base, number: '  245 ' })).toMatchObject({
      direction: 'outgoing',
      number: '245',
    });
    expect(mapDocumentDto({ ...base, number: '   ' }).number).toBeNull();
    expect(mapDocumentDto(base).number).toBeNull();
  });

  it('mapDocumentDto: null signedAt becomes null', () => {
    const out = mapDocumentDto({
      externalId: 'd-no-signed',
      orderExternalId: 'o1',
      direction: 'incoming',
      type: 'contract',
      name: 'f.pdf',
      mimeType: 'application/pdf',
      size: 1,
      downloadUrl: 'fake://x',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.signedAt).toBeNull();
  });

  it('mapOrgDto: null optional fields become null', () => {
    const out = mapOrgDto({
      externalId: 'org-bare',
      name: 'Bare Org',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.inn).toBeNull();
    expect(out.kpp).toBeNull();
    expect(out.partnerExternalId).toBeNull();
  });

  describe('mapOrgDto — У-171: реквизиты контрагента (Д-23)', () => {
    const base = {
      externalId: 'org-req',
      name: 'ООО Реквизиты',
      updatedAt: '2026-05-01T00:00:00Z',
    };

    it('legalName и девять реквизитов доезжают до OrgUpsertInput (сам Д-23)', () => {
      const out = mapOrgDto({
        ...base,
        inn: '7701234567',
        kpp: '770101001',
        legalName: 'Общество с ограниченной ответственностью «Реквизиты»',
        ogrn: '1027700000001',
        legalAddress: '101000, г. Москва, ул. Первая, д. 1',
        bankName: 'ПАО Банк',
        bankAccount: '40702810000000000001',
        corrAccount: '30101810000000000001',
        bic: '044525001',
        signerName: 'Иванов И. И.',
        signerPosition: 'Генеральный директор',
        signerBasis: 'Устава',
      });
      expect(out).toMatchObject({
        inn: '7701234567',
        kpp: '770101001',
        legalName: 'Общество с ограниченной ответственностью «Реквизиты»',
        ogrn: '1027700000001',
        legalAddress: '101000, г. Москва, ул. Первая, д. 1',
        bankName: 'ПАО Банк',
        bankAccount: '40702810000000000001',
        corrAccount: '30101810000000000001',
        bic: '044525001',
        signerName: 'Иванов И. И.',
        signerPosition: 'Генеральный директор',
        signerBasis: 'Устава',
      });
    });

    it('отсутствующие реквизиты — null, все двенадцать', () => {
      const out = mapOrgDto(base);
      for (const key of ORG_REQUISITE_KEYS) expect(out[key], key).toBeNull();
    });

    it('пустая строка и одни пробелы — это «поля нет», а не значение: → null; края обрезаются', () => {
      const out = mapOrgDto({
        ...base,
        legalName: '',
        legalAddress: '   ',
        bankName: '  ПАО Банк  ',
        kpp: '\t',
        inn: ' 7701234567 ',
      });
      expect(out.legalName).toBeNull();
      expect(out.legalAddress).toBeNull();
      expect(out.kpp).toBeNull();
      expect(out.bankName).toBe('ПАО Банк');
      expect(out.inn).toBe('7701234567');
    });
  });

  it('mapOrderDto: truthy optional date fields become Date instances', () => {
    const out = mapOrderDto({
      externalId: '1c-order-dates',
      title: 'T',
      totalAmount: 100,
      paidAmount: 50,
      paidAt: '2026-03-01T00:00:00Z',
      contractSignedAt: '2026-02-01T00:00:00Z',
      completedAt: '2026-04-01T00:00:00Z',
      closedAt: '2026-05-01T00:00:00Z',
      vatIncluded: true,
      executionStatus: 'completed' as const,
      financialStatus: 'paid' as const,
      productMix: [],
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.contractSignedAt).toBeInstanceOf(Date);
    expect(out.completedAt).toBeInstanceOf(Date);
    expect(out.closedAt).toBeInstanceOf(Date);
  });

  it('mapDocumentDto: truthy signedAt becomes a Date instance', () => {
    const out = mapDocumentDto({
      externalId: 'd-signed',
      orderExternalId: 'o1',
      direction: 'incoming',
      type: 'contract',
      name: 'f.pdf',
      mimeType: 'application/pdf',
      size: 1,
      signedAt: '2026-05-01T00:00:00Z',
      downloadUrl: 'fake://x',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(out.signedAt).toBeInstanceOf(Date);
  });
});
