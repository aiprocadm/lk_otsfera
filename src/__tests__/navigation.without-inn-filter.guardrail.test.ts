import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Страж отбора «без ИНН» (`У-94`, §0.2 — правило зеркала).
 *
 * Организации из выписки приходят без ИНН, и все три кабинета сотрудников
 * должны уметь показать именно их: это очередь работы, а не справочная
 * колонка. Отбор обязан называться одинаково и жить по одному адресу — иначе
 * человек, привыкший к одному кабинету, во втором его не найдёт.
 *
 * Проверяется по исходникам: разъехаться можно только правкой этих файлов.
 */
const SRC = join(process.cwd(), 'src');

const SCREENS = [
  { role: 'администратор', file: 'app/admin/organizations/page.tsx' },
  { role: 'менеджер', file: 'app/manager/organizations/page.tsx' },
  { role: 'руководитель', file: 'app/leader/organizations/page.tsx' },
];

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('отбор «без ИНН» одинаков во всех кабинетах (У-94)', () => {
  it.each(SCREENS)('$role: список читает отбор из адреса `?inn=without`', ({ file }) => {
    expect(read(file)).toContain("'without'");
  });

  it('подпись отбора одна и та же — «без ИНН»', () => {
    // У админа это пункт выпадающего списка рядом с другими отборами, у
    // менеджера и руководителя — ссылка-переключатель: вид разный, слова одни.
    expect(read('app/admin/organizations/page.tsx')).toContain('только без ИНН');
    expect(read('components/manager/manager-orgs-list.tsx')).toContain('без ИНН');
  });

  it('пустой результат отбора объясняет себя, а не молчит (У-74)', () => {
    expect(read('components/manager/manager-orgs-list.tsx')).toContain('Организаций без ИНН нет');
  });

  it('список показывает, у кого ИНН не заполнен', () => {
    // Без колонки отбор бесполезен: непонятно, что именно исправлять.
    expect(read('components/manager/manager-orgs-list.tsx')).toContain('не указан');
    expect(read('lib/services/manager/organizations.ts')).toContain('inn: true');
  });

  it('плашка «ИНН не указан» и кнопка есть во всех трёх карточках', () => {
    // Карточка у всех трёх кабинетов общая (с этапа 9 и у админа — до того
    // у него была своя простыня со своей плашкой): плашку рисует компонент,
    // а кнопку каждая страница передаёт ему сама.
    expect(read('components/manager/org-card-tabs.tsx')).toContain('ИНН не указан');
    for (const file of [
      'app/manager/organizations/[id]/page.tsx',
      'app/leader/organizations/[id]/page.tsx',
      'app/admin/organizations/[id]/page.tsx',
    ]) {
      expect(read(file), file).toContain('EgrulFillDialog');
    }
  });

  it('заказчику и партнёру кнопки «Найти в ЕГРЮЛ» не дают (`У-94` называет три роли)', () => {
    for (const file of [
      'app/organization/company/page.tsx',
      'app/partner/portfolio/[orgId]/page.tsx',
      'app/partner/portfolio/[orgId]/settings/page.tsx',
    ]) {
      expect(read(file), file).not.toContain('EgrulFillDialog');
    }
  });
});
