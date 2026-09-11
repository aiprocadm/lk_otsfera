import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
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

/** Ключи объекта; `refine` оборачивает объект в ZodEffects — разворачиваем. */
function shapeKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  expect(s, 'ожидался ZodObject').toBeInstanceOf(z.ZodObject);
  return Object.keys((s as z.ZodObject<z.ZodRawShape>).shape);
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

  it('образцы разделов 1–4 не пустые (страж читает именно их)', () => {
    for (const { n } of OPERATIONS) expect(sampleKeys(section(n)).length).toBeGreaterThan(5);
  });
});
