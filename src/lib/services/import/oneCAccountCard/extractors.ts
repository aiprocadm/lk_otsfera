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

/** Толерантный парс суммы: пробелы-разделители, запятая/точка как десятичный. */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** № документа 1С из строки 1 col[1]: 'Поступление ... 0000-001471 от ...' → '0000-001471'. */
export function extractDocNumber(line1: string | null | undefined): string | null {
  if (!line1) return null;
  const m = line1.match(/\b(\d{2,}-\d{3,})\b/);
  return m ? m[1] : null;
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
      const cand = m[1].replace(/[.,;]+$/, '');
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
  const line1 = col3.split('\n')[0].trim();
  const cleaned = line1.replace(/\s*ИНН\s*\d{10,12}\s*$/i, '').trim();
  return cleaned || null;
}

/** ИНН рядом с маркером 'ИНН'. */
export function extractInn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/ИНН\s*(\d{10,12})\b/i);
  return m ? m[1] : null;
}

/**
 * Сумма НДС из назначения. Приоритет:
 *  1) явная сумма ('НДС ... 704-75' / '3451.43') — берём её;
 *  2) 'не облагается' → 0;
 *  3) только ставка 'НДС N%' → вычисляем включённый НДС от amount: amount*rate/(100+rate);
 *  4) ничего → null.
 */
export function extractVat(purpose: string | null | undefined, amount: number | null): number | null {
  if (!purpose) return null;
  if (/НДС\s+не\s+облагается/i.test(purpose) || /без\s+НДС/i.test(purpose)) return 0;

  // явная сумма: 'НДС' [опц. ставка (5%)/5 %] ... затем число с дефис/точка/запятая-десятичным (704-75 = 704.75)
  const sumMatch = purpose.match(/НДС\s*(?:\(?\s*\d{1,2}\s*%\s*\)?)?[^0-9]*?(\d[\d\s]*)[.,-](\d{1,2})\b(?!\s*%)/i);
  if (sumMatch) {
    const whole = sumMatch[1].replace(/\s/g, '');
    return Number(`${whole}.${sumMatch[2]}`);
  }
  // явная сумма без копеек после 'НДС ... - 3451' (редко)
  const sumNoFrac = purpose.match(/НДС[^0-9%]*?(\d[\d\s]{2,})\s*(?:руб|р\b)/i);
  if (sumNoFrac) return parseAmount(sumNoFrac[1]);

  // только ставка
  const rateMatch = purpose.match(/НДС\s*\(?\s*(\d{1,2})\s*%/i) ?? purpose.match(/(\d{1,2})\s*%\s*НДС/i);
  if (rateMatch && amount != null) {
    const rate = Number(rateMatch[1]);
    if (rate > 0) return Math.round((amount * rate) / (100 + rate) * 100) / 100;
  }
  return null;
}
