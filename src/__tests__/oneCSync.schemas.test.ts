import { describe, expect, it } from 'vitest';
import {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCDocumentPushSchema,
  OneCDocumentPushResultSchema,
  ONE_C_PUSHABLE_TYPES,
} from '@/lib/services/oneCSync/schemas';
import { documentPushPayload } from '@/__tests__/helpers/oneCDocumentPush';

const validOrder = {
  externalId: '1c-order-1',
  title: 'T',
  organizationExternalId: '1c-org-1',
  totalAmount: 100,
  paidAmount: 50,
  vatIncluded: true,
  executionStatus: 'in_progress',
  financialStatus: 'partially_paid',
  productMix: ['training'],
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('oneCSync zod schemas', () => {
  it('OneCOrderSchema accepts a valid order', () => {
    expect(OneCOrderSchema.safeParse(validOrder).success).toBe(true);
  });
  it('OneCOrderSchema rejects a bad enum', () => {
    const r = OneCOrderSchema.safeParse({ ...validOrder, executionStatus: 'nope' });
    expect(r.success).toBe(false);
  });
  it('OneCOrderSchema rejects a non-numeric amount', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, totalAmount: '100' }).success).toBe(false);
  });
  it('OneCOrderSchema rejects garbage datetime but accepts ISO', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, updatedAt: 'not-a-date' }).success).toBe(
      false
    );
  });
  it('OneCOrgSchema requires externalId and name', () => {
    expect(OneCOrgSchema.safeParse({ name: 'x', updatedAt: '2026-05-01T00:00:00Z' }).success).toBe(
      false
    );
  });
  it('У-171: OneCOrgSchema принимает реквизиты контрагента и не требует ни одного из них', () => {
    const base = { externalId: 'org-1', name: 'ООО Реквизиты', updatedAt: '2026-05-01T00:00:00Z' };
    const full = {
      ...base,
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
    };
    // Все девять доезжают до DTO как есть — схема их не режет.
    expect(OneCOrgSchema.parse(full)).toEqual(full);
    // Без них запись валидна: 1С, которая реквизиты не отдаёт, не ломает обмен.
    expect(OneCOrgSchema.parse(base)).toEqual(base);
    // Реквизит — строка; число вместо ОГРН — брак записи, а не «примерно ОГРН».
    expect(OneCOrgSchema.safeParse({ ...base, ogrn: 1027700000001 }).success).toBe(false);
  });
  it('OneCPaymentSchema and OneCDocumentSchema accept valid records', () => {
    expect(
      OneCPaymentSchema.safeParse({
        externalId: 'p1',
        orderExternalId: 'o1',
        amount: 5,
        paidAt: '2026-05-01T00:00:00Z',
        isRefund: false,
        updatedAt: '2026-05-01T00:00:00Z',
      }).success
    ).toBe(true);
    expect(
      OneCDocumentSchema.safeParse({
        externalId: 'd1',
        orderExternalId: 'o1',
        type: 'act',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 1,
        downloadUrl: 'http://x/d1',
        updatedAt: '2026-05-01T00:00:00Z',
      }).success
    ).toBe(true);
  });

  it('У-170: документ без direction получает incoming; outgoing и number проходят как есть', () => {
    const base = {
      externalId: 'd1',
      orderExternalId: 'o1',
      type: 'act',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 1,
      downloadUrl: 'http://x/d1',
      updatedAt: '2026-05-01T00:00:00Z',
    };
    // 1С, которая поле ещё не отдаёт, — бумага её собственная
    expect(OneCDocumentSchema.parse(base)).toMatchObject({ direction: 'incoming' });
    expect(OneCDocumentSchema.parse(base)).not.toHaveProperty('number');
    expect(
      OneCDocumentSchema.parse({ ...base, direction: 'outgoing', number: '245' })
    ).toMatchObject({ direction: 'outgoing', number: '245' });
    expect(OneCDocumentSchema.safeParse({ ...base, direction: 'sideways' }).success).toBe(false);
  });

  it('payment accepts order-level ref', () => {
    expect(
      OneCPaymentSchema.safeParse({
        externalId: 'P1',
        orderExternalId: 'O1',
        amount: 100,
        paidAt: '2026-04-01T00:00:00Z',
        isRefund: false,
        updatedAt: '2026-04-01T00:00:00Z',
      }).success
    ).toBe(true);
  });
  it('payment accepts org-level ref (no order)', () => {
    expect(
      OneCPaymentSchema.safeParse({
        externalId: 'P2',
        organizationExternalId: 'ORG1',
        amount: 100,
        paidAt: '2026-04-01T00:00:00Z',
        isRefund: false,
        updatedAt: '2026-04-01T00:00:00Z',
      }).success
    ).toBe(true);
  });
  it('payment rejects when neither order nor org ref present', () => {
    expect(
      OneCPaymentSchema.safeParse({
        externalId: 'P3',
        amount: 100,
        paidAt: '2026-04-01T00:00:00Z',
        isRefund: false,
        updatedAt: '2026-04-01T00:00:00Z',
      }).success
    ).toBe(false);
  });

  it('payment accepts purpose/paymentOrderNumber/vatAmount fields (§7.1)', () => {
    const r = OneCPaymentSchema.safeParse({
      externalId: 'P4',
      orderExternalId: 'O1',
      amount: 200,
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      purpose: 'Оплата по договору',
      paymentOrderNumber: 'ПП-007',
      vatAmount: 36,
      updatedAt: '2026-04-01T00:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.purpose).toBe('Оплата по договору');
      expect(r.data.paymentOrderNumber).toBe('ПП-007');
      expect(r.data.vatAmount).toBe(36);
    }
  });

  it('payment accepts missing purpose/paymentOrderNumber/vatAmount (all nullish)', () => {
    const r = OneCPaymentSchema.safeParse({
      externalId: 'P5',
      orderExternalId: 'O1',
      amount: 100,
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-04-01T00:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.purpose).toBeUndefined();
      expect(r.data.paymentOrderNumber).toBeUndefined();
      expect(r.data.vatAmount).toBeUndefined();
    }
  });

  it('order accepts organizationInn instead of organizationExternalId', () => {
    expect(
      OneCOrderSchema.safeParse({
        externalId: 'O9',
        title: 't',
        organizationInn: '7700',
        totalAmount: 1,
        paidAmount: 0,
        vatIncluded: true,
        executionStatus: 'pending',
        financialStatus: 'billed',
        productMix: [],
        updatedAt: '2026-04-01T00:00:00Z',
      }).success
    ).toBe(true);
  });
  it('order rejects when neither org key present', () => {
    expect(
      OneCOrderSchema.safeParse({
        externalId: 'O9',
        title: 't',
        totalAmount: 1,
        paidAmount: 0,
        vatIncluded: true,
        executionStatus: 'pending',
        financialStatus: 'billed',
        productMix: [],
        updatedAt: '2026-04-01T00:00:00Z',
      }).success
    ).toBe(false);
  });
});

// Этап 8 (`У-167`): схема тела выгрузки документа — единственный источник
// правды о контракте (docs/integrations/1c-contract.md, секция 6) и для
// кабинета, и для mock-1c. Здесь проверяется ФОРМА; поведение по версиям —
// в тестах mock-1c/core/documents.
describe('OneCDocumentPushSchema (этап 8, У-167)', () => {
  it('accepts a full valid body', () => {
    expect(OneCDocumentPushSchema.safeParse(documentPushPayload()).success).toBe(true);
  });

  it('accepts null for order / parentDocument / lines / totals / kpp / legalName / vatRate', () => {
    const r = OneCDocumentPushSchema.safeParse(
      documentPushPayload({
        order: null,
        parentDocument: null,
        lines: [
          {
            title: 'Услуга',
            quantity: 1,
            unit: 'усл',
            price: 10,
            vatRate: null,
            vatAmount: 0,
            amount: 10,
          },
        ],
        totals: null,
        counterparty: { inn: '7701234567', kpp: null, name: 'ИП Иванов', legalName: null },
      })
    );
    expect(r.success).toBe(true);
  });

  it('accepts an order created in the cabinet (order.externalId = null, orderNumber set)', () => {
    const r = OneCDocumentPushSchema.safeParse(
      documentPushPayload({ order: { externalId: null, orderNumber: 'З-999' } })
    );
    expect(r.success).toBe(true);
  });

  it('accepts a reissue chain: parentDocument with the previous number', () => {
    const r = OneCDocumentPushSchema.safeParse(
      documentPushPayload({ version: 2, parentDocument: { externalId: 'doc-1', number: 'С-1' } })
    );
    expect(r.success).toBe(true);
  });

  it('rejects a commercial proposal — КП в 1С не выгружается (Р-14)', () => {
    const r = OneCDocumentPushSchema.safeParse({
      ...documentPushPayload(),
      type: 'commercial_proposal',
    });
    expect(r.success).toBe(false);
    expect(ONE_C_PUSHABLE_TYPES).not.toContain('commercial_proposal');
  });

  it('rejects a body without counterparty', () => {
    const { counterparty: _dropped, ...rest } = documentPushPayload();
    void _dropped;
    expect(OneCDocumentPushSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects counterparty without inn and document without number (stable codes are PR-3)', () => {
    expect(
      OneCDocumentPushSchema.safeParse(
        documentPushPayload({ counterparty: { inn: '', kpp: null, name: 'X', legalName: null } })
      ).success
    ).toBe(false);
    expect(OneCDocumentPushSchema.safeParse(documentPushPayload({ number: '' })).success).toBe(
      false
    );
  });

  it('rejects version 0 and a non-integer version', () => {
    expect(OneCDocumentPushSchema.safeParse(documentPushPayload({ version: 0 })).success).toBe(
      false
    );
    expect(OneCDocumentPushSchema.safeParse(documentPushPayload({ version: 1.5 })).success).toBe(
      false
    );
  });

  it('rejects a fileUrl that is not a URL', () => {
    expect(
      OneCDocumentPushSchema.safeParse(documentPushPayload({ fileUrl: 'documents/x.pdf' })).success
    ).toBe(false);
  });

  it('rejects NaN amounts (NaN would serialize as null on the wire)', () => {
    expect(
      OneCDocumentPushSchema.safeParse(
        documentPushPayload({ totals: { net: Number.NaN, vat: 0, gross: 0 } })
      ).success
    ).toBe(false);
  });

  it('rejects a vatRate above 1 (rates are fractions, not percents)', () => {
    const line = { ...documentPushPayload().lines![0]!, vatRate: 20 };
    expect(OneCDocumentPushSchema.safeParse(documentPushPayload({ lines: [line] })).success).toBe(
      false
    );
  });

  it('OneCDocumentPushResultSchema requires a non-empty externalId', () => {
    expect(OneCDocumentPushResultSchema.safeParse({ externalId: '1c-doc-1' }).success).toBe(true);
    expect(OneCDocumentPushResultSchema.safeParse({ externalId: '' }).success).toBe(false);
    expect(OneCDocumentPushResultSchema.safeParse({}).success).toBe(false);
  });
});
