/**
 * Сумма прописью для печатных форм (`У-141`, этап 6).
 *
 * Своя функция, а не библиотека (решение спеки §6-1): правило склонения
 * простое и целиком описывается двумя таблицами, а чужая зависимость в
 * PDF-контуре — лишний риск в самом ответственном месте (счёт с неверной
 * суммой прописью бухгалтерия не примет).
 *
 * Формат — как в бухгалтерских бланках: «Двенадцать тысяч рублей 00 копеек».
 * Копейки цифрами: так их печатают в счетах и так их проще сверять.
 */

const ONES_MALE = [
  '',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
const ONES_FEMALE = [
  '',
  'одна',
  'две',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

/** Формы слова для 1, 2–4 и 0/5–20: «рубль · рубля · рублей». */
type Forms = readonly [one: string, few: string, many: string];

const RUB: Forms = ['рубль', 'рубля', 'рублей'];
const KOP: Forms = ['копейка', 'копейки', 'копеек'];
const THOUSAND: Forms = ['тысяча', 'тысячи', 'тысяч'];
const MILLION: Forms = ['миллион', 'миллиона', 'миллионов'];
const BILLION: Forms = ['миллиард', 'миллиарда', 'миллиардов'];

/**
 * Выбор формы существительного по числу — обычное русское правило:
 * 11–14 всегда «многие» (одиннадцать рублей), иначе смотрим последнюю цифру.
 */
export function pluralForm(n: number, forms: Forms): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  const last = abs % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** Трёхзначная группа словами. `female` — для тысяч («две тысячи»). */
function groupToWords(group: number, female: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(group / 100);
  const rest = group % 100;
  if (hundreds > 0) words.push(HUNDREDS[hundreds]!);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]!);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens > 0) words.push(TENS[tens]!);
    if (ones > 0) words.push((female ? ONES_FEMALE : ONES_MALE)[ones]!);
  }
  return words;
}

/** Целое число словами (без названия валюты). Ноль → «ноль». */
export function integerToWords(value: number): string {
  const n = Math.abs(Math.trunc(value));
  if (n === 0) return 'ноль';

  const groups: Array<{ value: number; forms: Forms | null; female: boolean }> = [
    { value: Math.floor(n / 1_000_000_000) % 1000, forms: BILLION, female: false },
    { value: Math.floor(n / 1_000_000) % 1000, forms: MILLION, female: false },
    { value: Math.floor(n / 1000) % 1000, forms: THOUSAND, female: true },
    // Единицы: род задаёт валюта, поэтому здесь мужской, а «одна тысяча»
    // выше — женский. Перепутать эти два — классическая ошибка бланка.
    { value: n % 1000, forms: null, female: false },
  ];

  const words: string[] = [];
  for (const g of groups) {
    if (g.value === 0) continue;
    words.push(...groupToWords(g.value, g.female));
    if (g.forms) words.push(pluralForm(g.value, g.forms));
  }
  return words.join(' ');
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Сумма прописью: «Двенадцать тысяч рублей 00 копеек».
 *
 * На вход — строка фиксированной точности («12000.00»), как её отдают
 * сервисы: `Decimal` через границу не проходит, а `number` теряет копейки на
 * больших суммах.
 */
export function amountInWords(amount: string | number): string {
  const raw = typeof amount === 'number' ? amount.toFixed(2) : amount.trim().replace(',', '.');
  const negative = raw.startsWith('-');
  const cleaned = negative ? raw.slice(1) : raw;
  // Режем по точке вручную: значение по умолчанию в деструктуризации здесь
  // недостижимо (split всегда даёт хотя бы один кусок), а порог покрытия
  // считает его непройденной веткой.
  const dot = cleaned.indexOf('.');
  const rublesRaw = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const kopecksRaw = dot === -1 ? '' : cleaned.slice(dot + 1);
  const rubles = Number(rublesRaw.replace(/\s/g, '')) || 0;
  // «12.5» — это 50 копеек, а не 5: дополняем справа, а не слева.
  const kopecks = Number((kopecksRaw + '00').slice(0, 2)) || 0;

  const words = `${integerToWords(rubles)} ${pluralForm(rubles, RUB)}`;
  const kop = `${String(kopecks).padStart(2, '0')} ${pluralForm(kopecks, KOP)}`;
  return `${negative ? 'минус ' : ''}${capitalize(words)} ${kop}`;
}
