import { Prisma } from '@prisma/client';

/**
 * Этап 5 (`У-139`, `У-140`) — арифметика строк заказа.
 *
 * Чистые функции без базы: их же берёт печать документов этапа 6, поэтому
 * правило «как считается сумма» живёт в одном месте. Считаем на
 * `Prisma.Decimal` — накопление во float даёт дрейф в копейках (проектный
 * канон, см. `partner/finance.ts`), наружу отдаём строки фиксированной
 * точности: `Decimal` через границу server→client не проходит.
 */

export type LineInput = {
  quantity: string;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
};

export type LineTotals = {
  /** Сумма строки (снимок): количество × цена − скидка. */
  amount: string;
  /** Сумма без НДС. */
  net: string;
  /** Сумма НДС. */
  vat: string;
  /** Сумма с НДС. */
  gross: string;
};

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Число из формы. Пробелы-разделители тысяч и запятая — обычный человеческий
 * ввод; пустое или мусорное значение — ноль, а не исключение: арифметика
 * строки не должна ронять экран (ревью PR-4 нашло падение на строке из
 * одного пробела).
 */
function d(value: string | number): Prisma.Decimal {
  if (typeof value === 'number') return new Prisma.Decimal(value);
  const cleaned = value.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*(\.\d+)?$/.test(cleaned) || cleaned === '.') {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(cleaned);
}

function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, HALF_UP).toFixed(2);
}

/**
 * Сумма строки и её разложение по НДС.
 *
 * `vatIncluded` меняет НАПРАВЛЕНИЕ расчёта, а не только подпись: при «цена
 * включает НДС» налог выделяется из суммы (`amount × rate/(1+rate)`), иначе
 * начисляется сверху (`amount × rate`). Перепутать эти два — обычный способ
 * разойтись с бухгалтерией на 20%.
 */
export function computeLineTotals(input: LineInput): LineTotals {
  const quantity = d(input.quantity || '0');
  const unitPrice = d(input.unitPrice || '0');
  const discount = d(input.discountPercent ?? '0');

  const base = quantity.mul(unitPrice);
  const afterDiscount = base.mul(d(100).minus(discount)).div(100);
  const amount = afterDiscount.toDecimalPlaces(2, HALF_UP);

  if (input.vatRate === null) {
    // «Не облагается» (УСН): налога нет, сумма и есть итог.
    const zero = d(0);
    return { amount: money(amount), net: money(amount), vat: money(zero), gross: money(amount) };
  }

  const rate = d(input.vatRate);
  if (input.vatIncluded) {
    const vat = amount.mul(rate).div(d(1).plus(rate)).toDecimalPlaces(2, HALF_UP);
    return {
      amount: money(amount),
      net: money(amount.minus(vat)),
      vat: money(vat),
      gross: money(amount),
    };
  }
  const vat = amount.mul(rate).toDecimalPlaces(2, HALF_UP);
  return {
    amount: money(amount),
    net: money(amount),
    vat: money(vat),
    gross: money(amount.plus(vat)),
  };
}

export type OrderTotals = { net: string; vat: string; gross: string };

/**
 * Итоги заказа: складываем разложения строк.
 *
 * Складываем именно построчные (уже округлённые) значения — так печатная
 * форма и итог сходятся до копейки; округление общей суммы «в конце» дало бы
 * расхождение с таблицей на глазах у клиента.
 */
export function sumOrderTotals(lines: LineInput[]): OrderTotals {
  let net = d(0);
  let vat = d(0);
  let gross = d(0);
  for (const line of lines) {
    const t = computeLineTotals(line);
    net = net.plus(d(t.net));
    vat = vat.plus(d(t.vat));
    gross = gross.plus(d(t.gross));
  }
  return { net: money(net), vat: money(vat), gross: money(gross) };
}
