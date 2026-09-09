import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Страж «постраничный список листается устойчиво» (хотфикс №25 сопровождения,
 * находка `С-8` от 09.09.2026, прогон №18).
 *
 * ЗАЧЕМ. PostgreSQL при равных значениях ключа сортировки **не обещает**
 * никакого порядка, а для `ORDER BY ... LIMIT n [OFFSET m]` выбирает top-N
 * heapsort, результат которого зависит от `n` и `m`. Значит две соседние
 * страницы сортируются независимо: строка с общим ключом может попасть на обе,
 * а её соседка — ни на одну. Человек видит это как «одна и та же заявка на двух
 * страницах, а другой нет вовсе» — и никакого сообщения об ошибке.
 *
 * Проверено на живой базе 09.09.2026: 5000 строк с одинаковым `issued`,
 * страницы по 20 — запись `id=1` показана на страницах 1, 2 и 3, записи 21 и 41
 * не показаны; из 60 показанных строк уникальных 58.
 *
 * ПОЧЕМУ ЭТО НЕ РЕДКОСТЬ. Умолчание `createdAt` в схеме — `CURRENT_TIMESTAMP`,
 * а это время **начала транзакции**: все строки, созданные одной пачкой
 * (импорт из 1С, зачисление списком, выпуск пачки документов), получают
 * абсолютно одинаковый `createdAt`. Для `issuedAt` (дата выдачи удостоверения)
 * совпадения гарантированы и без транзакции.
 *
 * ЧТО ТРЕБУЕТ СТРАЖ. У каждой постраничной выборки (`skip` в аргументах
 * `findMany` — прямо или через подставляемый объект пагинации; либо листание
 * курсором) последним ключом `orderBy` стоит уникальное поле `id`. Тогда
 * порядок определён однозначно, и границы страниц перестают «дышать».
 *
 * ПОЧЕМУ ТЕКСТОВЫЙ РАЗБОР. Аргументы `findMany` — литерал объекта в исходнике;
 * в рантайме его не достать, не подняв всю выборку на живой базе. Блок
 * аргументов вырезается по балансу скобок, а не регуляркой, — вложенные
 * `include` с их собственными `orderBy` внутрь проверки не попадают.
 */

const SERVICES = join(__dirname, '..', 'lib', 'services');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Блок аргументов вызова `findMany({ … })` целиком, по балансу фигурных скобок. */
function findManyBlocks(src: string): Array<{ block: string; at: number }> {
  const out: Array<{ block: string; at: number }> = [];
  const call = /\.findMany\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    const start = src.indexOf('{', m.index);
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          out.push({ block: src.slice(start, i + 1), at: m.index });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Ключи верхнего уровня блока и их значения. Вложенные `include`/`select` со
 * своими `orderBy` внутрь не попадают: считается глубина скобок.
 */
function topLevelEntries(block: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]!;
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    const m = /^(\.\.\.)?([A-Za-z_]\w*)\s*(:)?/.exec(block.slice(i));
    if (!m) continue;
    const key = (m[1] ?? '') + m[2]!;
    if (!m[3]) {
      // `...pagination` без двоеточия — подстановка объекта.
      out.push({ key, value: '' });
      i += m[0].length - 1;
      continue;
    }
    // Значение — до запятой того же уровня или до конца блока.
    let j = i + m[0].length;
    let d = 0;
    const start = j;
    for (; j < block.length; j++) {
      const c = block[j]!;
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') {
        if (d === 0) break;
        d--;
      } else if (c === ',' && d === 0) break;
    }
    out.push({ key, value: block.slice(start, j).trim() });
    i = j - 1;
  }
  return out;
}

/** `orderBy` верхнего уровня вместе со значением (объект или массив объектов). */
function orderByOf(block: string): string | null {
  return topLevelEntries(block).find((e) => e.key === 'orderBy')?.value ?? null;
}

/** Последний ключ сортировки — `id`? */
function endsWithId(orderBy: string): boolean {
  const keys = [...orderBy.matchAll(/(\w+)\s*:\s*'(?:asc|desc)'/g)].map((m) => m[1]);
  return keys.length > 0 && keys[keys.length - 1] === 'id';
}

/**
 * Очередь неустойчивых постраничных выборок — **закрыта 09.09.2026** (прогон
 * №20, хотфикс №32). Всего таких выборок было девятнадцать; закрывались по три
 * файла за хотфикс (лимит §9.4) хотфиксами №25, №26 и №28–№32.
 *
 * Список обязан оставаться пустым: новая выборка со страницами и без хвоста
 * `id` — это дефект, а не «пока не дошли руки». Если исключение всё же
 * понадобится, рядом с ним должна стоять причина и дата, а тест ниже не даст
 * ему залежаться после починки.
 */
const QUEUE: ReadonlyArray<string> = [];

describe('С-8: постраничный список листается устойчиво', () => {
  const files = walk(SERVICES);

  /** Имена переменных, в объявлении которых есть `skip` (объект пагинации). */
  function paginationVars(src: string): string[] {
    return [...src.matchAll(/const\s+(\w+)[^=]*=\s*[^;]*?skip[^;]*?;/gs)].map((m) => m[1]!);
  }

  function unstable(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    const vars = paginationVars(src);
    const bad: string[] = [];
    for (const { block } of findManyBlocks(src)) {
      const keys = topLevelEntries(block).map((e) => e.key);
      const paged =
        keys.includes('skip') ||
        keys.includes('cursor') ||
        vars.some((v) => keys.includes(`...${v}`)) ||
        // `...(opts.cursor ? { cursor: …, skip: 1 } : {})` — подстановка выражением.
        /\.\.\.\([^)]*\b(?:skip|cursor)\s*:/s.test(block);
      if (!paged) continue;
      const orderBy = orderByOf(block);
      if (!orderBy) {
        bad.push('выборка со страницами вообще без orderBy');
        continue;
      }
      if (!endsWithId(orderBy)) bad.push(orderBy.replace(/\s+/g, ' ').slice(0, 90));
    }
    return bad;
  }

  it('у каждой постраничной выборки последний ключ сортировки — id', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SERVICES, file).split(sep).join('/');
      if (QUEUE.includes(rel)) continue;
      for (const b of unstable(file)) offenders.push(`${rel}: ${b}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('очередь пуста и только сокращается: залежавшихся исключений нет', () => {
    const fixed = QUEUE.filter((rel) => unstable(join(SERVICES, rel)).length === 0);
    expect(fixed, `уже починены, убери из очереди: ${fixed.join(', ')}`).toEqual([]);
  });

  it('места, закрытые хотфиксами №25, №26, №28–№31, разбираются стражем как устойчивые', () => {
    const fixedNow = [
      'training/certificates.ts',
      'partner/portfolio.ts',
      'enrollments/list.ts',
      'organization/orders.ts',
      'organization/documents.ts',
      'organization/students.ts',
      'partner/orders.ts',
      'partner/documentsList.ts',
      'partner/finance.ts',
      'clientRequests/list.ts',
      'manager/leads.ts',
      'inbound/listInbox.ts',
      'admin/organizations.ts',
      'admin/partners.ts',
      'admin/users/queries.ts',
      'organization/orgCardEmployees.ts',
      'telephony/listCalls.ts',
      'admin/commissionStatements.ts',
      'import/oneCAccountCard/resolve-queue.ts',
    ];
    const still = fixedNow.filter((rel) => unstable(join(SERVICES, rel)).length > 0);
    expect(still, still.join(', ')).toEqual([]);
  });
});
