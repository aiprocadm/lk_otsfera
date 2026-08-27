import { Prisma } from '@prisma/client';
import type { CatalogUnit } from '@prisma/client';
import { computeLineTotals } from '@/lib/services/orders/lineMath';
import { CATALOG_UNIT_LABELS } from '@/lib/services/admin/catalogItems';
import { amountInWords } from '@/lib/format/amountInWords';

/**
 * Табличная часть печатной формы (`У-141`, `У-142`, этап 6).
 *
 * Чистая сборка без базы: строки заказа (или одна строка-заглушка `У-142`) →
 * готовые к печати ячейки, итоги, строка НДС, «Всего наименований N» и сумма
 * прописью. Арифметику берём у `lineMath` этапа 5 — одна и та же на экране
 * заказа, в счёте и в будущей выгрузке в 1С: если посчитать здесь заново,
 * табличка на экране и цифра в счёте разойдутся в копейках, и объяснить это
 * клиенту будет нечем.
 *
 * Деньги форматируем сами, а не `toLocaleString`: сборка Node без полного ICU
 * молча отдаёт другой разделитель, и счёт печатается с «15,000.00» вместо
 * «15 000,00».
 */

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
/** Неразрывный пробел: разряды числа не должны переноситься на другую строку. */
const NBSP = '\u00A0';

export type PrintLineInput = {
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
};

export type PrintRow = {
  /** Порядковый номер в печатной форме, с единицы. */
  index: number;
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

export type PrintTable = {
  rows: PrintRow[];
  /** Сырые суммы фиксированной точности — для сверки с суммой заказа (`У-143`). */
  subtotal: string;
  vat: string;
  gross: string;
  /** «Итого: 15 000,00 ₽» — сумма колонки «Сумма». */
  subtotalLine: string;
  /** «В том числе НДС 20% — 2 500,00 ₽» либо «НДС не облагается». */
  vatLine: string;
  /** «Всего к оплате: 18 000,00 ₽» — только когда НДС начислен сверх суммы. */
  payableLine: string | null;
  /** «Всего наименований 2, на сумму 15 000,00 ₽». */
  itemsSummary: string;
  /** «Пятнадцать тысяч рублей 00 копеек». */
  totalInWords: string;
};

/** Деньги в русском виде без знака валюты: «15 000,00». */
export function formatMoney(value: string | number | Prisma.Decimal): string {
  const fixed = new Prisma.Decimal(value).toDecimalPlaces(2, HALF_UP).toFixed(2);
  const negative = fixed.startsWith('-');
  // `toFixed(2)` всегда даёт «ddd.dd», поэтому режем по позиции точки, а не
  // деструктуризацией со значениями по умолчанию: недостижимое значение по
  // умолчанию — это непройденная ветка в пороге покрытия.
  const digits = fixed.replace('-', '');
  const dot = digits.indexOf('.');
  const grouped = digits.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? '-' : ''}${grouped},${digits.slice(dot + 1)}`;
}

/** Количество без хвостовых нулей: «2», «1,5», «0,25». */
function formatQuantity(value: string): string {
  return new Prisma.Decimal(value).toDecimalPlaces(3, HALF_UP).toFixed().replace('.', ',');
}

/** Ставка НДС долей → «20%», «7,5%». */
function formatRate(rate: string): string {
  return new Prisma.Decimal(rate).mul(100).toDecimalPlaces(2, HALF_UP).toFixed().replace('.', ',');
}

/**
 * Строка-заглушка для заказа без состава (`У-142`).
 *
 * Цена строки — сумма заказа, а НДС **выделяется из неё**, если заказ так
 * помечен: `Order.totalAmount` — это итог с НДС (его пишет `syncOrderTotal`
 * этапа 5). Начислить налог сверх этой суммы значило бы выставить клиенту
 * счёт больше, чем показывает карточка заказа.
 */
export function fallbackPrintLine(input: {
  orderNumber: string | null;
  title: string;
  totalAmount: string;
  vatRate: string | null;
  vatIncluded: boolean;
}): PrintLineInput {
  const number = input.orderNumber === null ? '' : ` №${input.orderNumber}`;
  return {
    title: `Услуги по заказу${number}: ${input.title}`,
    quantity: '1',
    unit: 'service',
    unitPrice: input.totalAmount,
    discountPercent: null,
    vatRate: input.vatRate,
    vatIncluded: input.vatIncluded,
  };
}

export function buildPrintTable(lines: PrintLineInput[]): PrintTable {
  const rows: PrintRow[] = [];
  let subtotal = new Prisma.Decimal(0);
  let vat = new Prisma.Decimal(0);
  let gross = new Prisma.Decimal(0);

  lines.forEach((line, i) => {
    const totals = computeLineTotals(line);
    rows.push({
      index: i + 1,
      name: line.title,
      quantity: formatQuantity(line.quantity),
      unit: CATALOG_UNIT_LABELS[line.unit],
      unitPrice: formatMoney(line.unitPrice),
      amount: formatMoney(totals.amount),
    });
    // Складываем уже округлённые построчные значения — так «Итого» сходится
    // с колонкой «Сумма» до копейки (правило `lineMath` этапа 5).
    subtotal = subtotal.plus(totals.amount);
    vat = vat.plus(totals.vat);
    gross = gross.plus(totals.gross);
  });

  // Ставка НДС: одна на все строки — печатаем её; разные — печатаем «НДС»
  // без ставки, потому что назвать одну из них общей было бы враньём.
  // Сравниваем уже готовые подписи: «0.2» и «0.2000» — одна и та же ставка.
  const rateLabels = new Set<string>();
  for (const line of lines) {
    if (line.vatRate !== null) rateLabels.add(formatRate(line.vatRate));
  }
  const rateLabel = rateLabels.size === 1 ? ` ${[...rateLabels].join('')}%` : '';

  const vatLine =
    rateLabels.size > 0
      ? `В том числе НДС${rateLabel} — ${formatMoney(vat)} ₽`
      : 'НДС не облагается';

  // «Всего к оплате» показываем, только когда налог начислен сверх суммы
  // строк: иначе это была бы та же цифра дважды.
  const payable = gross.equals(subtotal) ? null : `Всего к оплате: ${formatMoney(gross)} ₽`;

  return {
    rows,
    subtotal: subtotal.toFixed(2),
    vat: vat.toFixed(2),
    gross: gross.toFixed(2),
    subtotalLine: `Итого: ${formatMoney(subtotal)} ₽`,
    vatLine,
    payableLine: payable,
    itemsSummary: `Всего наименований ${rows.length}, на сумму ${formatMoney(gross)} ₽`,
    totalInWords: amountInWords(gross.toFixed(2)),
  };
}
