/** Чистые экстракторы полей карточки счёта 51. Без Prisma/HTTP — ядро TDD. */

const DDMMYYYY = /\b(\d{2})\.(\d{2})\.(\d{4})\b/;

/** 'ДД.ММ.ГГГГ' → ISO (UTC midnight) или null. */
export function parseRusDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = String(input).match(DDMMYYYY);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Толерантный парс суммы. 1С выгружает деньги в разных форматах, и от настроек
 * базы зависит, что считается разделителем:
 *   `1 200,50`   — русский (пробел тысячи, запятая дробь);
 *   `14,800.00`  — английский (запятая тысячи, точка дробь);
 *   `2600.1`, `14800` — без разделителей.
 *
 * Прежняя версия просто меняла первую запятую на точку, поэтому `14,800.00`
 * превращалось в `14.800.00` → `NaN` → «не найдена сумма». На живой выписке
 * (жалоба 10.08.2026) так падали ВСЕ 129 платежей.
 */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/[\s  ]/g, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Есть оба знака: дробным считается тот, что правее, второй — тысячи.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else {
    const sep = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : '';
    if (sep) {
      const parts = s.split(sep);
      const tail = parts[parts.length - 1]!;
      // Разделитель один и хвост ровно из трёх цифр — это тысячи («14,800»),
      // деньги пишут с двумя знаками после дробной части.
      const isThousands = parts.length > 2 || (parts.length === 2 && /^\d{3}$/.test(tail));
      s = isThousands ? parts.join('') : parts.join('.');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * № документа 1С из первой строки колонки «Документ».
 *
 * 1С печатает документ как «<Тип> <Номер> от <ДД.ММ.ГГГГ> <время>», а вот сам
 * номер зависит от настроек базы: `0000-001471`, `БП-000123`, `ПП00-000045`,
 * иногда просто `123`. Раньше здесь стоял единственный шаблон
 * «цифры-дефис-цифры» — в базе с буквенным префиксом **ни одна** строка не
 * получала номера, и весь файл уходил в «ошибки разбора». Поэтому основной
 * способ теперь — взять то, что стоит **перед словом «от» и датой**, и лишь
 * затем пробовать частные шаблоны.
 *
 * Номер обязан содержать цифру: без неё это слово из названия документа, а не
 * номер (и такой «номер» стал бы одинаковым ключом у разных платежей).
 */
export function extractDocNumber(line1: string | null | undefined): string | null {
  if (!line1) return null;
  const text = String(line1);

  // 1. «… <номер> от 01.06.2026» — как 1С печатает почти всегда.
  const beforeDate = text.match(/(?:№\s*)?(\S+)\s+от\s+\d{2}\.\d{2}\.\d{4}/i);
  if (beforeDate && /\d/.test(beforeDate[1]!)) return beforeDate[1]!.replace(/^№/, '');

  // 2. Прежний шаблон «0000-001471» — на случай строки без «от <дата>».
  const dashed = text.match(/\b(\d{2,}-\d{3,})\b/);
  if (dashed) return dashed[1]!;

  // 3. Явный «№ 123».
  const hashed = text.match(/№\s*(\S+)/);
  if (hashed && /\d/.test(hashed[1]!)) return hashed[1]!;

  return null;
}

// Паттерны № счёта в свободном тексте. Ядро: 'счет/сч/счёт/счета № <код>'.
// Код: цифры с возможными буквами (рус/лат) и дефисами, мин. длина 4.
const ACCOUNT_PATTERNS: RegExp[] = [
  /сч[её]т[а-я]*\s*№?\s*([0-9][0-9A-Za-zА-Яа-я-]{3,})/gi,
  /сч\s*№\s*([0-9][0-9A-Za-zА-Яа-я-]{3,})/gi,
  /согласно\s+сч[её]т[а-я]*\s+([0-9][0-9A-Za-zА-Яа-я-]{3,})/gi,
];

/** Все кандидаты № счёта (дедуп, в порядке появления). */
export function extractAccountCandidates(text: string | null | undefined): string[] {
  if (!text) return [];
  const hits: Array<{ cand: string; idx: number }> = [];
  for (const re of ACCOUNT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      // Во всех ACCOUNT_PATTERNS группа 1 обязательна — при совпадении она заполнена.
      const cand = m[1]!.replace(/[.,;]+$/, '');
      // The capture group requires ≥4 chars and trailing punctuation is not in its
      // class, so `cand.length < 4` (the false side) is unreachable.
      /* v8 ignore next */
      if (cand.length >= 4) hits.push({ cand, idx: m.index ?? 0 });
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  const found: string[] = [];
  for (const h of hits) if (!found.includes(h.cand)) found.push(h.cand);
  return found;
}

/** Наименование контрагента — строка 1 col[3], без хвостового 'ИНН <digits>'. */
export function extractCounterparty(col3: string | null | undefined): string | null {
  if (!col3) return null;
  // String.split всегда возвращает минимум один элемент — [0] существует.
  const line1 = col3.split('\n')[0]!.trim();
  const cleaned = line1.replace(/\s*ИНН\s*\d{10,12}\s*$/i, '').trim();
  return cleaned || null;
}

/** ИНН рядом с маркером 'ИНН'. */
export function extractInn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/ИНН\s*(\d{10,12})\b/i);
  // Группа 1 обязательна в паттерне: если match сработал, она заполнена.
  return m ? m[1]! : null;
}

/**
 * Сумма НДС из назначения. Приоритет:
 *  1) явная сумма ('НДС ... 704-75' / '3451.43') — берём её;
 *  2) 'не облагается' → 0;
 *  3) только ставка 'НДС N%' → вычисляем включённый НДС от amount: amount*rate/(100+rate);
 *  4) ничего → null.
 */
export function extractVat(
  purpose: string | null | undefined,
  amount: number | null
): number | null {
  if (!purpose) return null;
  if (/НДС\s+не\s+облагается/i.test(purpose) || /без\s+НДС/i.test(purpose)) return 0;

  // явная сумма: 'НДС' [опц. ставка (5%)/5 %] ... затем число с дефис/точка/запятая-десятичным (704-75 = 704.75)
  const sumMatch = purpose.match(
    /НДС\s*(?:\(?\s*\d{1,2}\s*%\s*\)?)?[^0-9]*?(\d[\d\s]*)[.,-](\d{1,2})\b(?!\s*%)/i
  );
  if (sumMatch) {
    // Группы 1 и 2 обязательны в паттерне: при совпадении обе заполнены.
    const whole = sumMatch[1]!.replace(/\s/g, '');
    return Number(`${whole}.${sumMatch[2]}`);
  }
  // явная сумма без копеек после 'НДС ... - 3451' (редко)
  const sumNoFrac = purpose.match(/НДС[^0-9%]*?(\d[\d\s]{2,})\s*(?:руб|р\b)/i);
  if (sumNoFrac) return parseAmount(sumNoFrac[1]);

  // только ставка
  const rateMatch =
    purpose.match(/НДС\s*\(?\s*(\d{1,2})\s*%/i) ?? purpose.match(/(\d{1,2})\s*%\s*НДС/i);
  if (rateMatch && amount != null) {
    const rate = Number(rateMatch[1]);
    if (rate > 0) return Math.round(((amount * rate) / (100 + rate)) * 100) / 100;
  }
  return null;
}
