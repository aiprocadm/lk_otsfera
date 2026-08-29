/**
 * Этап 6 ТЗ (`У-148`) — признак оплаты счёта.
 *
 * Признак **вычисляемый и только вычисляемый**: руками его не ставят.
 * `У-150` прямо запрещает кнопку «Оплачено» у заказчика — иначе это способ
 * объявить оплату, которой не было. Источник правды один: платежи заказа.
 *
 * Связь «платёж → счёт» берётся из назначения платежа: банк не знает про наши
 * документы, но бухгалтер пишет «оплата по счёту С-2026-17». Отсюда два
 * честных исхода вместо одного удобного:
 *
 * - **сопоставили** — деньги относятся к этому счёту, считаем сумму;
 * - **не сопоставили** — платежи по заказу есть, но ни один не сослался на
 *   этот счёт. Экран говорит «не удалось сопоставить», а не «не оплачен»:
 *   первое — правда о нашем знании, второе — утверждение о деньгах клиента.
 *
 * **Почему не переиспользован `extractAccountCandidates`** из импорта выписки:
 * он ищет номера, начинающиеся с цифры (так выглядят номера 1С), а наши
 * сгенерированные номера начинаются с буквы типа — «С-2026-17». Расширять
 * общий извлекатель ради этого нельзя: он кормит матчер импорта, и лишний
 * кандидат там разводит платежи по чужим заказам. Здесь задача другая — не
 * «угадай номер», а «сослались ли на ЭТОТ номер».
 */

export type InvoicePaymentState = 'unpaid' | 'partially_paid' | 'paid';

export const PAYMENT_STATE_LABELS: Record<InvoicePaymentState, string> = {
  unpaid: 'Не оплачен',
  partially_paid: 'Оплачен частично',
  paid: 'Оплачен',
};

export type InvoicePaymentPayment = {
  /** Decimal из Prisma приходит строкой; число тоже принимаем. */
  amount: string | number;
  isRefund: boolean;
  purpose: string | null;
  note: string | null;
};

export type InvoicePaymentInput = {
  /** Номер счёта, как он напечатан в документе. */
  number: string | null;
  /** Итог с НДС. У документов до этапа 6 его нет. */
  amountGross: string | number | null;
  payments: InvoicePaymentPayment[];
};

export type InvoicePaymentResult = {
  state: InvoicePaymentState;
  /** Сколько денег зачтено по этому счёту, в рублях. */
  paid: number;
  /** Хотя бы один платёж сослался на этот счёт. */
  matched: boolean;
  /** Был платёж, назвавший сразу несколько счетов, — деньги не разнесены. */
  ambiguous: boolean;
};

/**
 * Кириллические двойники латинских букв. Номер печатается кириллицей
 * («С-2026-17»), а из банка возвращается латиницей («C-2026-17»): человек
 * видит одни и те же буквы, программа — разные символы. Без свёртки счёт
 * молча остался бы «не оплачен».
 */
const HOMOGLYPHS: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

/** Номер в сравнимом виде: без пробелов, в верхнем регистре, без двойников. */
function normalizeNumber(raw: string): string {
  return (
    raw
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      // Класс символов в регулярке и ключи таблицы — один и тот же набор,
      // поэтому `?? ch` недостижим: замена вызывается только на найденной букве.
      /* v8 ignore next */
      .replace(/[АВЕКМНОРСТУХ]/g, (ch) => HOMOGLYPHS[ch] ?? ch)
  );
}

/**
 * Номера счетов, названные в тексте платежа.
 *
 * Ищем не «что-нибудь похожее на номер», а токен сразу после слова «счёт» —
 * так пишут в назначении. Токен обязан содержать цифру: иначе «оплата по
 * счёту получателя» дала бы кандидата «получателя».
 */
const ACCOUNT_MARKER = /сч[её]т[а-я]*\s*№?\s*([0-9A-Za-zА-Яа-я][0-9A-Za-zА-Яа-я-]{2,})/gi;

export function referencedInvoiceNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const m of text.matchAll(ACCOUNT_MARKER)) {
    const token = m[1]!.replace(/[.,;]+$/, '');
    if (!/\d/.test(token)) continue;
    const normalized = normalizeNumber(token);
    if (!found.includes(normalized)) found.push(normalized);
  }
  return found;
}

/** Рубли в копейки — чтобы сравнение сумм не зависело от плавающей точки. */
function toKopecks(value: string | number): number {
  return Math.round(Number(value) * 100);
}

/**
 * Состояние оплаты счёта или `null`, если судить не по чему: у документа нет
 * номера (сослаться не на что) или нет итоговой суммы (документы до этапа 6).
 * `null` — это «признак не показываем», а не «не оплачен».
 */
export function invoicePaymentState(input: InvoicePaymentInput): InvoicePaymentResult | null {
  if (!input.number || input.number.trim() === '') return null;
  if (input.amountGross === null) return null;

  const target = normalizeNumber(input.number);
  const totalKopecks = toKopecks(input.amountGross);

  let paidKopecks = 0;
  let matched = false;
  let ambiguous = false;

  for (const p of input.payments) {
    const numbers = referencedInvoiceNumbers(`${p.purpose ?? ''} ${p.note ?? ''}`);
    if (!numbers.includes(target)) continue;
    if (numbers.length > 1) {
      // Платёж назвал несколько счетов сразу: разнести его без домыслов
      // нельзя. Молча приписать всю сумму этому счёту — выдумать оплату.
      ambiguous = true;
      continue;
    }
    matched = true;
    paidKopecks += (p.isRefund ? -1 : 1) * toKopecks(p.amount);
  }

  const state: InvoicePaymentState =
    paidKopecks <= 0 ? 'unpaid' : paidKopecks >= totalKopecks ? 'paid' : 'partially_paid';

  return { state, paid: paidKopecks / 100, matched, ambiguous };
}
