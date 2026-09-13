import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Сопровождение, хотфикс №50 (`С-8`, прогон №27). Карточка контакта (этап 1 ТЗ
 * 12.09.2026) на вкладках «Заказы» и «Сделки» фильтрует по
 * `Order.primaryContactId` и `Deal.contactId` — обе колонки появились без
 * индекса, и каждый открытый контакт перебирал таблицы целиком. Страж держит
 * индексы в схеме: колонка, по которой ищет карточка, обязана быть
 * проиндексирована, а сама выборка в `get.ts` — по-прежнему идти по ней.
 */
const SCHEMA = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const GET = readFileSync(path.join(process.cwd(), 'src/lib/services/contacts/get.ts'), 'utf8');

function modelBody(name: string): string {
  const m = SCHEMA.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(m, `модель ${name} не найдена в schema.prisma`).not.toBeNull();
  return m![1]!;
}

describe('С-8: колонки, по которым карточка контакта ищет заказы и сделки, проиндексированы', () => {
  it('Order.primaryContactId — есть @@index', () => {
    expect(modelBody('Order')).toMatch(/@@index\(\[primaryContactId\]\)/);
  });

  it('Deal.contactId — есть @@index', () => {
    expect(modelBody('Deal')).toMatch(/@@index\(\[contactId\]\)/);
  });

  it('карточка контакта действительно ищет по этим колонкам (иначе страж охраняет пустоту)', () => {
    expect(GET).toMatch(/primaryContactId: contact\.id/);
    expect(GET).toMatch(/contactId: contact\.id, companyId: contact\.companyId/);
  });
});
