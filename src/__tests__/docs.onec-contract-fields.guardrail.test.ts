import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCDebtSchema,
} from '@/lib/services/oneCSync/schemas';

/**
 * Страж контракта 1С (хотфикс №42, прогон №24, `С-7`).
 *
 * `docs/integrations/1c-contract.md` — единственное, что видит команда 1С:
 * по нему они собирают выгрузку. Код же принимает то, что описано в Zod-схемах
 * `oneCSync/schemas.ts`. Они разъехались молча: схема заказа и платежа с
 * 14.06.2026 принимала `organizationInn` как второй ключ организации (и
 * требует хотя бы один из ключей), платёж — `purpose`, `paymentOrderNumber`,
 * `vatAmount`, а в контракте этих полей не было. 1С не могла узнать, что
 * платёж без `orderExternalId` можно адресовать по ИНН, а назначение платежа
 * доедет до карточки.
 *
 * Правило: каждое поле схемы входящего обмена упомянуто **как JSON-ключ**
 * (`"поле"`) в разделе документа про эту операцию — в образце ответа или в
 * примечаниях к нему. Обратное тоже: ключ из образца, которого нет в схеме,
 * — обещание, которое код не выполняет.
 */
const DOC = readFileSync(join(process.cwd(), 'docs/integrations/1c-contract.md'), 'utf8');

/** Раздел «### N. Заголовок» до следующего `### ` или `## `. */
function section(n: number): string {
  // Конец раздела — следующий заголовок `### `/`## ` или конец файла
  // (`\Z` в JS нет: это буква Z, и раздел обрывался бы на первом `…:00Z`).
  const re = new RegExp(`^### ${n}\\. [^\\n]*\\n([\\s\\S]*?)(?=^###? |$(?![\\s\\S]))`, 'm');
  const m = DOC.match(re);
  expect(m, `в контракте нет раздела ### ${n}.`).not.toBeNull();
  return m![1];
}

/**
 * Все ключи схемы, включая вложенные.
 *
 * Обёртки (`optional`, `nullable`, `refine`) разворачиваются, массивы —
 * обходятся по элементу. Раньше здесь брались только ключи верхнего уровня, и
 * этого хватало, пока контракт был плоским. С появлением `contacts`
 * (`У-256`, этап 8) вложенный объект стал законной частью обмена: команда 1С
 * собирает его по этому же документу, и поля внутри массива обязаны быть
 * описаны наравне с остальными — иначе `position` или `email` молча выпадут из
 * выгрузки, а страж этого не заметит.
 */
function shapeKeys(schema: z.ZodTypeAny): string[] {
  const keys = new Set<string>();

  const unwrap = (s: z.ZodTypeAny): z.ZodTypeAny => {
    let cur: z.ZodTypeAny = s;
    for (;;) {
      if (cur instanceof z.ZodEffects) cur = cur.innerType();
      else if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable)
        cur = cur.unwrap() as z.ZodTypeAny;
      else if (cur instanceof z.ZodDefault) cur = cur.removeDefault() as z.ZodTypeAny;
      else return cur;
    }
  };

  const walk = (s: z.ZodTypeAny): void => {
    const inner = unwrap(s);
    if (inner instanceof z.ZodArray) {
      walk(inner.element as z.ZodTypeAny);
      return;
    }
    if (inner instanceof z.ZodObject) {
      for (const [key, value] of Object.entries((inner as z.ZodObject<z.ZodRawShape>).shape)) {
        keys.add(key);
        walk(value as z.ZodTypeAny);
      }
    }
  };

  const root = unwrap(schema);
  expect(root, 'ожидался ZodObject').toBeInstanceOf(z.ZodObject);
  walk(root);
  return [...keys];
}

/** Ключи JSON-образца в разделе: строки вида `"externalId": …` внутри ```json. */
function sampleKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const block of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    for (const m of block[1].matchAll(/^\s*"([A-Za-z][A-Za-z0-9]*)"\s*:/gm)) keys.add(m[1]);
  }
  return [...keys];
}

const OPERATIONS = [
  { n: 1, name: 'Organizations', schema: OneCOrgSchema },
  { n: 2, name: 'Orders', schema: OneCOrderSchema },
  { n: 3, name: 'Payments', schema: OneCPaymentSchema },
  { n: 4, name: 'Documents', schema: OneCDocumentSchema },
  // `У-257`: метод ещё не реализован в 1С, но контракт его уже описывает — и
  // описание обязано совпадать со схемой так же строго, как у работающих
  // методов. Иначе к моменту реализации сторона 1С соберёт не то.
  { n: 8, name: 'Debts', schema: OneCDebtSchema },
];

describe('контракт 1С описывает все поля, которые принимает код (С-7)', () => {
  it.each(OPERATIONS)('$name: каждое поле схемы упомянуто в разделе $n', ({ n, schema }) => {
    const text = section(n);
    const missing = shapeKeys(schema).filter((k) => !text.includes(`"${k}"`));
    expect(missing, `в разделе ${n} контракта не описаны поля схемы`).toEqual([]);
  });

  it.each(OPERATIONS)(
    '$name: образец ответа не обещает полей, которых нет в схеме',
    ({ n, schema }) => {
      const known = new Set(shapeKeys(schema));
      const extra = sampleKeys(section(n)).filter((k) => !known.has(k));
      expect(extra, `в образце раздела ${n} есть поля, которых код не принимает`).toEqual([]);
    }
  );

  it('образцы разделов не пустые (страж читает именно их)', () => {
    // У сверки дебиторки полей всего четыре — предел на неё отдельный, иначе
    // пришлось бы выдумывать поля ради стража.
    const minKeys: Record<number, number> = { 8: 3 };
    for (const { n } of OPERATIONS) {
      expect(sampleKeys(section(n)).length).toBeGreaterThan(minKeys[n] ?? 5);
    }
  });
});
