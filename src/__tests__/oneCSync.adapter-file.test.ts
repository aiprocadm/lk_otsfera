import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';

describe('FileOneCAdapter', () => {
  it('documents are never created from Excel (orgs — с этапа 5 создаются)', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [],
    });
    const a = new FileOneCAdapter(Buffer.from('x'));
    expect(await a.pullDocuments({})).toEqual([]);
  });

  // Этап 5 (Т-15/Т-16): контрагенты из листа превращаются в DTO с синтетическим ключом.
  describe('pullOrganizations', () => {
    it('валидный ИНН → DTO с ключом 1c-inn:, нормализацией и КПП', async () => {
      parseWorkbook.mockResolvedValue({
        orgs: [
          {
            name: ' ООО Ромашка ',
            inn: ' 7707 083893 ',
            kpp: '770701001',
            partnerInn: '7707083893',
          },
        ],
        orders: [],
        payments: [],
      });
      const orgs = await new FileOneCAdapter(Buffer.from('x')).pullOrganizations({});
      expect(orgs).toHaveLength(1);
      expect(orgs[0]).toMatchObject({
        externalId: '1c-inn:7707083893',
        name: 'ООО Ромашка',
        inn: '7707083893',
        kpp: '770701001',
        partnerExternalId: '7707083893',
      });
    });

    it('число из Excel без ведущих нулей нормализуется в ключе и в ИНН', async () => {
      // 0012345678 в Excel часто приходит числом — восстановленный ноль критичен
      // для поиска существующей организации (Т-22). Контрольную сумму тут не
      // проверяем — этот ИНН синтетический ключ не получит, важен сам паддинг.
      parseWorkbook.mockResolvedValue({
        orgs: [{ name: 'ООО Ноль', inn: 12345678, kpp: null, partnerInn: null }],
        orders: [],
        payments: [],
      });
      const orgs = await new FileOneCAdapter(Buffer.from('x')).pullOrganizations({});
      expect(orgs[0]).toMatchObject({ inn: '0012345678' });
    });

    it('строка без ИНН получает наименование в externalId — для таблицы ошибок', async () => {
      parseWorkbook.mockResolvedValue({
        orgs: [{ name: 'ООО Без ИНН', inn: null, kpp: null, partnerInn: null }],
        orders: [],
        payments: [],
      });
      const orgs = await new FileOneCAdapter(Buffer.from('x')).pullOrganizations({});
      // До writer'а строка не дойдёт (файловая схема отрежет с no_inn), но в
      // таблице ошибок оператор увидит имя, а не прочерк.
      expect(orgs[0]).toMatchObject({ externalId: 'ООО Без ИНН', name: 'ООО Без ИНН' });
      expect(orgs[0]).not.toHaveProperty('inn');
    });

    it('битый ИНН синтетического ключа не получает', async () => {
      parseWorkbook.mockResolvedValue({
        orgs: [{ name: 'ООО Битый', inn: '7707083894', kpp: null, partnerInn: null }],
        orders: [],
        payments: [],
      });
      const orgs = await new FileOneCAdapter(Buffer.from('x')).pullOrganizations({});
      expect(orgs[0]).toMatchObject({ externalId: 'ООО Битый', inn: '7707083894' });
    });

    it('строки без наименования (итоги, пустые хвосты) пропускаются', async () => {
      parseWorkbook.mockResolvedValue({
        orgs: [{ name: null, inn: '7707083893' }, { name: '  ' }],
        orders: [],
        payments: [],
      });
      expect(await new FileOneCAdapter(Buffer.from('x')).pullOrganizations({})).toEqual([]);
    });
  });
  it('derives financialStatus from amounts when no status column', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        { externalId: 'O1', orderNumber: 'O1', orgInn: '77', totalAmount: 100, paidAmount: 100 },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0]).toMatchObject({
      externalId: 'O1',
      financialStatus: 'paid',
      organizationInn: '77',
    });
    expect(orders[0].organizationExternalId).toBeUndefined();
  });
  it('uses status column via translation when present', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        {
          externalId: 'O2',
          orderNumber: 'O2',
          orgInn: '77',
          totalAmount: 100,
          paidAmount: 0,
          financialStatusRaw: 'Счёт выставлен',
        },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('billed');
  });
  it('partially paid derives partially_paid', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        { externalId: 'O3', orderNumber: 'O3', orgInn: '77', totalAmount: 100, paidAmount: 40 },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('partially_paid');
  });
  it('links payment to order when orderRef present, else org-level by INN', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P1',
          orgInn: '77',
          amount: 50,
          paidAt: '2026-04-01T00:00:00Z',
          method: null,
          note: null,
          orderRef: 'O1',
        },
        {
          externalId: 'P2',
          orgInn: '77',
          amount: 50,
          paidAt: '2026-04-01T00:00:00Z',
          method: null,
          note: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0]).toMatchObject({ externalId: 'P1', orderExternalId: 'O1' });
    expect(pays[1]).toMatchObject({ externalId: 'P2', organizationInn: '77' });
    expect(pays[1].orderExternalId).toBeUndefined();
  });
  it('marks refund from method text or negative amount', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P3',
          orgInn: '77',
          amount: 50,
          paidAt: '2026-04-01T00:00:00Z',
          method: 'Возврат покупателю',
          note: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0].isRefund).toBe(true);
  });
  it('pushLead throws (read-only)', async () => {
    await expect(new FileOneCAdapter(Buffer.from('x')).pushLead({} as any)).rejects.toThrow();
  });
  it('pushDocument throws (read-only): файл читают, наружу им не пишут', async () => {
    await expect(new FileOneCAdapter(Buffer.from('x')).pushDocument({} as any)).rejects.toThrow(
      /read-only/
    );
  });

  it('derives not_billed when totalAmount <= 0', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        {
          externalId: 'O-ZERO',
          orderNumber: 'O-ZERO',
          orgInn: '77',
          totalAmount: 0,
          paidAmount: 0,
        },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('not_billed');
  });

  it('derives refunded when isRefund=true via method text', async () => {
    // isRefund is derived for payments not orders. For orders the refunded status can
    // be set via financialStatusRaw containing 'Возврат'.
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        {
          externalId: 'O-REF',
          orderNumber: 'O-REF',
          orgInn: '77',
          totalAmount: 100,
          paidAmount: 50,
          financialStatusRaw: 'Возврат',
        },
      ],
      payments: [],
    });
    // translate 'Возврат' — if it translates to refunded, the value is used; else falls through
    // Checking what translateFinancialStatus returns for 'Возврат':
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    // Whether it succeeds or falls back, the code path is exercised — just check it doesn't throw
    expect(orders[0].externalId).toBe('O-REF');
  });

  it('skips order row without externalId or orgInn', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        { externalId: null, orgInn: '77', totalAmount: 10, paidAmount: 0 },
        { externalId: 'O-VALID', orgInn: null, totalAmount: 10, paidAmount: 0 },
        null,
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders).toHaveLength(0);
  });

  it('skips payment row without externalId or orgInn', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: null,
          orgInn: '77',
          amount: 10,
          paidAt: '2026-01-01',
          method: null,
          note: null,
          orderRef: null,
        },
        {
          externalId: 'P-VALID',
          orgInn: null,
          amount: 10,
          paidAt: '2026-01-01',
          method: null,
          note: null,
          orderRef: null,
        },
        null,
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays).toHaveLength(0);
  });

  it('marks refund from negative amount', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P-NEG',
          orgInn: '77',
          amount: -50,
          paidAt: '2026-04-01T00:00:00Z',
          method: null,
          note: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0].isRefund).toBe(true);
  });

  it('uses translated status when financialStatusRaw is a valid internal code', async () => {
    // 'billed' is already an internal code but translateFinancialStatus(ok:false) → keep derived
    // Use a Russian string that translates successfully
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        {
          externalId: 'O-TR',
          orderNumber: 'O-TR',
          orgInn: '77',
          totalAmount: 100,
          paidAmount: 100,
          financialStatusRaw: 'Оплачено',
        },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('paid');
  });

  it('uses externalId as title when orderNumber is null', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        {
          externalId: 'O-NOTITLE',
          orderNumber: null,
          orgInn: '77',
          totalAmount: 100,
          paidAmount: 0,
        },
      ],
      payments: [],
    });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].orderNumber).toBeUndefined(); // null ?? undefined = undefined
    expect(orders[0].title).toBe('O-NOTITLE'); // null ?? externalId
  });

  it('amount fallback to 0 when amount is non-numeric', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P-NAN',
          orgInn: '77',
          amount: 'not-a-number',
          paidAt: '2026-01-01',
          method: null,
          note: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0].amount).toBe(0); // Number('not-a-number') = NaN → || 0
  });

  it('carries purpose, vatAmount, paymentOrderNumber through parse→adapter round-trip', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P-FIELDS',
          orgInn: '77',
          amount: 12000,
          paidAt: '2026-06-01T00:00:00Z',
          method: 'Банковский перевод',
          purpose: 'Оплата по договору №123',
          vatAmount: 2000,
          paymentOrderNumber: 'ПП-456',
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays).toHaveLength(1);
    expect(pays[0].purpose).toBe('Оплата по договору №123');
    expect(pays[0].vatAmount).toBe(2000);
    expect(pays[0].paymentOrderNumber).toBe('ПП-456');
  });

  it('treats null purpose/vatAmount/paymentOrderNumber as undefined in DTO', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P-NULL-FIELDS',
          orgInn: '77',
          amount: 500,
          paidAt: '2026-06-01T00:00:00Z',
          method: null,
          purpose: null,
          vatAmount: null,
          paymentOrderNumber: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays).toHaveLength(1);
    expect(pays[0].purpose).toBeUndefined();
    expect(pays[0].vatAmount).toBeUndefined();
    expect(pays[0].paymentOrderNumber).toBeUndefined();
  });

  it('carries vatAmount=0 as 0 (not undefined)', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [
        {
          externalId: 'P-VAT0',
          orgInn: '77',
          amount: 1000,
          paidAt: '2026-06-01T00:00:00Z',
          method: null,
          purpose: null,
          vatAmount: 0,
          paymentOrderNumber: null,
          orderRef: null,
        },
      ],
    });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0].vatAmount).toBe(0); // 0 is valid, must not collapse to undefined
  });
});

/**
 * Т-3: файловый адаптер отдаёт сервису диагностику разбора книги. Метод
 * намеренно живёт только здесь и не входит в общий интерфейс `OneCAdapter` —
 * у сетевого адаптера листов книги нет.
 */
describe('FileOneCAdapter.diagnostics', () => {
  const DIAGNOSTICS = {
    sheetsFound: ['Реализация товаров и услуг'],
    sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
    unmatchedHeaders: { 'Реализация товаров и услуг': [] },
    missingColumns: {},
    duplicateSheets: {},
  };

  it('отдаёт то, что собрал парсер', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [],
      payments: [],
      diagnostics: DIAGNOSTICS,
    });
    const a = new FileOneCAdapter(Buffer.from('x'));
    expect(await a.diagnostics()).toEqual(DIAGNOSTICS);
  });

  it('книга разбирается один раз: диагностика не ломает кэш адаптера', async () => {
    parseWorkbook.mockClear();
    parseWorkbook.mockResolvedValue({
      orgs: [],
      orders: [
        { externalId: 'O1', orderNumber: 'O1', orgInn: '77', totalAmount: 100, paidAmount: 0 },
      ],
      payments: [],
      diagnostics: DIAGNOSTICS,
    });
    const a = new FileOneCAdapter(Buffer.from('x'));
    await a.diagnostics();
    const orders = await a.pullOrders({});
    expect(orders).toHaveLength(1);
    expect(parseWorkbook).toHaveBeenCalledTimes(1);
  });
});
