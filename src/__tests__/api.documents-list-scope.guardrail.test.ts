import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers/source';

/**
 * Список документов не отбирается в браузере.
 *
 * `DocumentsPanel` живёт в двух местах: на общем экране `/admin/documents` и
 * на карточке заказа `/admin/orders/[id]`. На карточке ей нужны документы
 * ОДНОГО заказа — а панель просила у `/api/documents` весь список платформы
 * и оставляла нужные строки локальным `filter`. Чтобы показать три строки,
 * администратору уезжали метаданные всех документов системы, и предела у
 * выборки не было вовсе (сопровождение `С-8`, 07.09.2026, хотфикс №18).
 *
 * Правило: фильтр по заказу — в запросе, у выборки есть `take`, рядом —
 * `count` по тому же условию.
 */
const SRC = join(__dirname, '..');
const read = (rel: string) => readSource(join(SRC, rel));

describe('api/documents: срез и фильтр считает сервер', () => {
  it('сервис режет выборку и считает total по тому же условию', () => {
    const src = read('lib/services/documents/list.ts');
    expect(src, 'предел выборки не задан').toMatch(/take:\s*DOCUMENTS_API_CAP/);
    expect(src, 'нет счётчика по тому же условию').toMatch(/count\(\{\s*where\s*\}\)/);
    expect(src, 'фильтр по заказу не дошёл до условия выборки').toMatch(/opts\.orderId/);
  });

  it('роут читает orderId из запроса и отдаёт rows + total', () => {
    const src = read('app/api/documents/route.ts');
    expect(src, 'роут не читает orderId из адреса').toContain("searchParams.get('orderId')");
    expect(src, 'ответ без полного счётчика').toMatch(/rows:.*total:/s);
  });

  it('панель не отбирает документы заказа в браузере', () => {
    const src = read('components/documents/documents-panel.tsx');
    expect(src, 'панель не передаёт orderId в запрос').toContain('/api/documents?orderId=');
    // Именно этот `filter` и был дефектом: он оставлял серверу всю выборку.
    expect(src, 'вернулся локальный отбор по orderId').not.toMatch(
      /\.filter\(\([^)]*\)\s*=>\s*!?\w*[Оо]?rderId/
    );
  });

  it('панель показывает подпись усечения', () => {
    const src = read('components/documents/documents-panel.tsx');
    expect(src, 'нет подписи «показаны первые N из M»').toContain('ListCapNotice');
  });
});
