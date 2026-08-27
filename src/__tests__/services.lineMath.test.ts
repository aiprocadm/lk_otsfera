/**
 * Этап 5 (`У-139`, `У-140`) — арифметика строк заказа.
 *
 * Это «исполняемая бухгалтерия»: те же числа увидит печатная форма этапа 6.
 * Поэтому проверяем не «функция что-то вернула», а конкретные суммы до копейки
 * — включая два места, где ошибка стоит денег:
 *   1) `vatIncluded` меняет НАПРАВЛЕНИЕ расчёта (выделить налог из суммы vs
 *      начислить сверху) — путаница даёт расхождение ровно на ставку;
 *   2) итог складывает УЖЕ ОКРУГЛЁННЫЕ построчные значения, а не округляет
 *      общую сумму в конце — иначе таблица на бумаге не сойдётся с её же итогом.
 */
import { describe, it, expect } from 'vitest';
import { computeLineTotals, sumOrderTotals, type LineInput } from '@/lib/services/orders/lineMath';

const line = (over: Partial<LineInput> = {}): LineInput => ({
  quantity: '1',
  unitPrice: '12000',
  discountPercent: null,
  vatRate: '0.20',
  vatIncluded: true,
  ...over,
});

describe('computeLineTotals — направление расчёта НДС', () => {
  it('НДС включён в цену: налог ВЫДЕЛЯЕТСЯ из суммы (12000 → 2000 внутри)', () => {
    expect(computeLineTotals(line({ vatIncluded: true }))).toEqual({
      amount: '12000.00',
      net: '10000.00',
      vat: '2000.00',
      gross: '12000.00',
    });
  });

  it('НДС сверху: налог НАЧИСЛЯЕТСЯ на сумму (12000 + 20% = 14400)', () => {
    expect(computeLineTotals(line({ vatIncluded: false }))).toEqual({
      amount: '12000.00',
      net: '12000.00',
      vat: '2400.00',
      gross: '14400.00',
    });
  });

  it('«не облагается» (vatRate = null): налога нет ни в какую сторону, флаг vatIncluded не влияет', () => {
    const expected = {
      amount: '12000.00',
      net: '12000.00',
      vat: '0.00',
      gross: '12000.00',
    };
    expect(computeLineTotals(line({ vatRate: null, vatIncluded: true }))).toEqual(expected);
    expect(computeLineTotals(line({ vatRate: null, vatIncluded: false }))).toEqual(expected);
  });

  it('ставка 0 (нулевой НДС) — это НЕ «не облагается»: налог считается и равен нулю', () => {
    // Ноль и «прочерк» в счёте — разные вещи: при ставке 0 строка облагаемая.
    expect(computeLineTotals(line({ vatRate: '0', vatIncluded: false }))).toEqual({
      amount: '12000.00',
      net: '12000.00',
      vat: '0.00',
      gross: '12000.00',
    });
  });
});

describe('computeLineTotals — количество, скидка, пустые поля', () => {
  it('сумма строки = количество × цена, скидка снимается ДО расчёта налога', () => {
    // 3 × 5000 = 15000, минус 10% = 13500; НДС 20% внутри = 2250.
    expect(
      computeLineTotals({ ...line(), quantity: '3', unitPrice: '5000', discountPercent: '10' })
    ).toEqual({
      amount: '13500.00',
      net: '11250.00',
      vat: '2250.00',
      gross: '13500.00',
    });
  });

  it('скидка 100% обнуляет строку, скидка 0 равна её отсутствию', () => {
    expect(computeLineTotals(line({ discountPercent: '100' })).amount).toBe('0.00');
    expect(computeLineTotals(line({ discountPercent: '0' }))).toEqual(
      computeLineTotals(line({ discountPercent: null }))
    );
  });

  it('дробное количество (3 знака) считается точно, без дрейфа float', () => {
    // 0.125 × 800 = 100 ровно. На float это классическое место потери копеек.
    expect(computeLineTotals({ ...line(), quantity: '0.125', unitPrice: '800' }).amount).toBe(
      '100.00'
    );
  });

  it('пустые строки количества и цены читаются как ноль, а не как NaN', () => {
    expect(computeLineTotals({ ...line(), quantity: '', unitPrice: '' })).toEqual({
      amount: '0.00',
      net: '0.00',
      vat: '0.00',
      gross: '0.00',
    });
  });
});

describe('computeLineTotals — округление ROUND_HALF_UP на копеечных остатках', () => {
  it('1 руб. с НДС 20% внутри: 0.1666… → 0.17, остаток 0.83, итог ровно 1.00', () => {
    expect(computeLineTotals({ ...line(), unitPrice: '1' })).toEqual({
      amount: '1.00',
      net: '0.83',
      vat: '0.17',
      gross: '1.00',
    });
  });

  it('ровно половина копейки округляется ВВЕРХ (0.005 → 0.01), а не «к чётному»', () => {
    // Банковское округление (HALF_EVEN) дало бы здесь 0.00 и разошлось бы с 1С.
    expect(
      computeLineTotals({ ...line(), unitPrice: '0.05', vatRate: '0.10', vatIncluded: false })
    ).toEqual({ amount: '0.05', net: '0.05', vat: '0.01', gross: '0.06' });
  });

  it('половина копейки в самой сумме строки (скидка 50% от 10.01) тоже идёт вверх: 5.005 → 5.01', () => {
    expect(
      computeLineTotals({
        ...line(),
        unitPrice: '10.01',
        discountPercent: '50',
        vatRate: null,
      }).amount
    ).toBe('5.01');
  });
});

describe('sumOrderTotals — итог складывает построчные округлённые значения', () => {
  it('пустой список даёт нули, а не пустые строки', () => {
    expect(sumOrderTotals([])).toEqual({ net: '0.00', vat: '0.00', gross: '0.00' });
  });

  it('три строки по 1 руб. с НДС внутри: 0.17 × 3 = 0.51, а НЕ 0.50 «от общей суммы»', () => {
    // Ключевая проверка: если бы налог считали от итога 3.00, вышло бы 0.50 —
    // и печатная форма (три раза по 0.17) не сошлась бы со своим же итогом.
    const one = { ...line(), unitPrice: '1' };
    expect(sumOrderTotals([one, one, one])).toEqual({
      net: '2.49',
      vat: '0.51',
      gross: '3.00',
    });
  });

  it('смешанный заказ: строка с НДС внутри + строка с НДС сверху + необлагаемая', () => {
    expect(
      sumOrderTotals([
        line({ vatIncluded: true }), // 12000 → net 10000, vat 2000, gross 12000
        line({ vatIncluded: false }), // 12000 → net 12000, vat 2400, gross 14400
        line({ vatRate: null }), // 12000 → net 12000, vat 0, gross 12000
      ])
    ).toEqual({ net: '34000.00', vat: '4400.00', gross: '38400.00' });
  });

  it('одна строка: итог заказа совпадает с разложением этой строки', () => {
    const only = line({ vatIncluded: false });
    const t = computeLineTotals(only);
    expect(sumOrderTotals([only])).toEqual({ net: t.net, vat: t.vat, gross: t.gross });
  });
});
