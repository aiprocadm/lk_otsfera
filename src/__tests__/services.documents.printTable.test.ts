import { describe, it, expect } from 'vitest';
import {
  buildPrintTable,
  fallbackPrintLine,
  formatMoney,
  type PrintLineInput,
} from '@/lib/services/documents/printTable';
import { sumOrderTotals } from '@/lib/services/orders/lineMath';

/**
 * `У-141` — табличная часть счёта и акта: шесть колонок, итоги, НДС,
 * «Всего наименований N» и сумма прописью. `У-142` — заказ без состава.
 *
 * Здесь живёт вся арифметика печати, поэтому проверяем её на цифрах, а не на
 * «функция что-то вернула»: ошибка в этом файле — это неверная сумма в счёте
 * у клиента.
 */
const NBSP = '\u00A0';

function line(over: Partial<PrintLineInput> = {}): PrintLineInput {
  return {
    title: 'Обучение по охране труда',
    quantity: '2',
    unit: 'person',
    unitPrice: '6000.00',
    discountPercent: null,
    vatRate: '0.2000',
    vatIncluded: true,
    ...over,
  };
}

describe('formatMoney', () => {
  it('разряды разделены неразрывным пробелом, копейки — запятой', () => {
    // Неразрывный: «15 000,00» не должно разорваться переносом строки надвое.
    expect(formatMoney('15000')).toBe(`15${NBSP}000,00`);
    expect(formatMoney('1234567.5')).toBe(`1${NBSP}234${NBSP}567,50`);
  });

  it('меньше тысячи — без разделителя; ноль и минус печатаются', () => {
    expect(formatMoney('999.99')).toBe('999,99');
    expect(formatMoney(0)).toBe('0,00');
    expect(formatMoney('-1500')).toBe(`-1${NBSP}500,00`);
  });

  it('третий знак округляется по правилу «половина вверх»', () => {
    expect(formatMoney('0.005')).toBe('0,01');
  });
});

describe('buildPrintTable — шесть колонок', () => {
  it('строка печатает номер, название, количество, единицу, цену и сумму', () => {
    const t = buildPrintTable([line()]);
    expect(t.rows).toEqual([
      {
        index: 1,
        name: 'Обучение по охране труда',
        quantity: '2',
        unit: 'чел.',
        unitPrice: `6${NBSP}000,00`,
        amount: `12${NBSP}000,00`,
      },
    ]);
  });

  it('количество без хвостовых нулей: «1,5», а не «1,500»', () => {
    const t = buildPrintTable([line({ quantity: '1.500', unit: 'hour' })]);
    expect(t.rows[0]!.quantity).toBe('1,5');
    expect(t.rows[0]!.unit).toBe('час');
  });

  it('нумерация сквозная — 1, 2, 3', () => {
    const t = buildPrintTable([line(), line(), line()]);
    expect(t.rows.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  it('скидка уменьшает сумму строки, но не цену за единицу', () => {
    const t = buildPrintTable([line({ discountPercent: '10' })]);
    expect(t.rows[0]!.unitPrice).toBe(`6${NBSP}000,00`);
    expect(t.rows[0]!.amount).toBe(`10${NBSP}800,00`);
  });
});

describe('buildPrintTable — итоги и НДС', () => {
  it('цены с НДС: налог выделяется, «Всего к оплате» не печатается', () => {
    const t = buildPrintTable([line()]);
    expect(t.subtotalLine).toBe(`Итого: 12${NBSP}000,00 ₽`);
    expect(t.vatLine).toBe(`В том числе НДС 20% — 2${NBSP}000,00 ₽`);
    // Итог и «к оплате» совпали бы до копейки — вторая строка была бы шумом.
    expect(t.payableLine).toBeNull();
    expect(t.gross).toBe('12000.00');
  });

  it('цены без НДС: налог сверху, «Всего к оплате» появляется', () => {
    const t = buildPrintTable([line({ vatIncluded: false })]);
    expect(t.subtotalLine).toBe(`Итого: 12${NBSP}000,00 ₽`);
    expect(t.vatLine).toBe(`В том числе НДС 20% — 2${NBSP}400,00 ₽`);
    expect(t.payableLine).toBe(`Всего к оплате: 14${NBSP}400,00 ₽`);
    expect(t.gross).toBe('14400.00');
  });

  it('без ставки — «НДС не облагается» (УСН), а не «НДС 0%»', () => {
    // Ноль процентов и «не облагается» — разные вещи: первое печатается
    // ставкой, второе снимает налог совсем.
    const t = buildPrintTable([line({ vatRate: null })]);
    expect(t.vatLine).toBe('НДС не облагается');
    expect(t.vat).toBe('0.00');

    const zero = buildPrintTable([line({ vatRate: '0' })]);
    expect(zero.vatLine).toBe('В том числе НДС 0% — 0,00 ₽');
  });

  it('одна ставка, записанная по-разному, остаётся одной ставкой', () => {
    // «0.2» из формы и «0.2000» из базы — та же двадцатка; печатать «НДС»
    // без ставки на этом месте было бы неправдой.
    const t = buildPrintTable([line({ vatRate: '0.2' }), line({ vatRate: '0.2000' })]);
    expect(t.vatLine).toBe(`В том числе НДС 20% — 4${NBSP}000,00 ₽`);
  });

  it('разные ставки в одном документе — НДС без ставки', () => {
    const t = buildPrintTable([line(), line({ vatRate: '0.1000' })]);
    expect(t.vatLine).toBe(`В том числе НДС — 3${NBSP}090,91 ₽`);
  });

  it('дробная ставка печатается запятой: 7,5%', () => {
    const t = buildPrintTable([line({ vatRate: '0.0750' })]);
    expect(t.vatLine).toContain('НДС 7,5%');
  });

  it('пустой состав: итоги нулевые, документ всё равно собирается', () => {
    const t = buildPrintTable([]);
    expect(t.rows).toEqual([]);
    expect(t.subtotalLine).toBe('Итого: 0,00 ₽');
    expect(t.vatLine).toBe('НДС не облагается');
    expect(t.itemsSummary).toBe('Всего наименований 0, на сумму 0,00 ₽');
    expect(t.totalInWords).toBe('Ноль рублей 00 копеек');
  });
});

describe('buildPrintTable — итог совпадает с суммой заказа', () => {
  it('печатный итог равен итогу, который считает карточка заказа', () => {
    // Главный инвариант этапа: карточка заказа и счёт считают одним ядром
    // (`lineMath`). Разойдись они — клиент увидит две разные цифры.
    const lines = [line(), line({ quantity: '3', unitPrice: '1999.99' })];
    expect(buildPrintTable(lines).gross).toBe(sumOrderTotals(lines).gross);
  });

  it('итог складывает округлённые строки, а не округляет сумму в конце', () => {
    const lines = [line({ quantity: '1', unitPrice: '0.015', vatRate: null })];
    // 0,015 → строка 0,02; итог тоже 0,02, а не 0,015 с округлением потом.
    expect(buildPrintTable(lines).subtotal).toBe('0.02');
  });
});

describe('buildPrintTable — «Всего наименований» и сумма прописью', () => {
  it('считает строки и печатает сумму к оплате словами', () => {
    const t = buildPrintTable([line(), line({ quantity: '1', unitPrice: '3000.00' })]);
    expect(t.itemsSummary).toBe(`Всего наименований 2, на сумму 15${NBSP}000,00 ₽`);
    expect(t.totalInWords).toBe('Пятнадцать тысяч рублей 00 копеек');
  });

  it('прописью — сумма С НДС, а не сумма строк', () => {
    // Клиент платит итог с налогом; прописью пишут именно его.
    const t = buildPrintTable([line({ vatIncluded: false })]);
    expect(t.totalInWords).toBe('Четырнадцать тысяч четыреста рублей 00 копеек');
  });
});

describe('fallbackPrintLine — заказ без состава (`У-142`)', () => {
  it('одна строка «Услуги по заказу №N» на сумму заказа', () => {
    const l = fallbackPrintLine({
      orderNumber: '123',
      title: 'Обучение по охране труда',
      totalAmount: '15000.00',
      vatRate: '0.2000',
      vatIncluded: true,
    });
    expect(l.title).toBe('Услуги по заказу №123: Обучение по охране труда');
    expect(l.quantity).toBe('1');
    expect(l.unit).toBe('service');
    expect(l.unitPrice).toBe('15000.00');
  });

  it('заказ без номера — без «№» и без дыры в названии', () => {
    const l = fallbackPrintLine({
      orderNumber: null,
      title: 'Аттестация',
      totalAmount: '100.00',
      vatRate: null,
      vatIncluded: true,
    });
    expect(l.title).toBe('Услуги по заказу: Аттестация');
  });

  it('итог заглушки равен сумме заказа: НДС выделяется, а не добавляется', () => {
    // Иначе счёт оказался бы больше, чем показывает карточка заказа.
    const t = buildPrintTable([
      fallbackPrintLine({
        orderNumber: '7',
        title: 'Обучение',
        totalAmount: '15000.00',
        vatRate: '0.2000',
        vatIncluded: true,
      }),
    ]);
    expect(t.gross).toBe('15000.00');
    expect(t.vatLine).toBe(`В том числе НДС 20% — 2${NBSP}500,00 ₽`);
    expect(t.payableLine).toBeNull();
  });
});
