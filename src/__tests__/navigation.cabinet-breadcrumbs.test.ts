import { describe, it, expect } from 'vitest';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Крошки вложенных экранов кабинетов (`У-72`, этап 9).
 *
 * Смысл проверок — не «строится ли массив», а два инварианта: название
 * раздела берётся из реестра меню (значит, переименование не разъедется), и
 * последняя крошка — текущая страница без ссылки (иначе человек кликает по
 * тому месту, где уже стоит).
 */
describe('buildCabinetBreadcrumbs (У-72)', () => {
  it('название раздела берётся из реестра меню, а не пишется руками', () => {
    // `У-103`: пункт «Сотрудники» у менеджера снят (люди ведутся в карточке
    // организации), поэтому пример взят на «Организациях» — том разделе,
    // внутрь которого сотрудники и переехали.
    const section = navByRole.manager.find((i) => i.href === '/manager/organizations');
    const crumbs = buildCabinetBreadcrumbs('manager', '/manager/organizations', [
      { label: 'ООО «Ромашка»' },
    ]);
    expect(crumbs[0]).toEqual({ label: section?.label, href: '/manager/organizations' });
  });

  it('последняя крошка — текущая страница и ссылки не имеет', () => {
    const crumbs = buildCabinetBreadcrumbs('admin', '/admin/users', [{ label: 'Пётр Петров' }]);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[1]).toEqual({ label: 'Пётр Петров', href: null });
  });

  it('промежуточные крошки сохраняют свои ссылки', () => {
    // Трёхуровневый случай: раздел → организация → её документы.
    const crumbs = buildCabinetBreadcrumbs('partner', '/partner/portfolio', [
      { label: 'ООО «Ромашка»', href: '/partner/portfolio/org-1' },
      { label: 'Документы' },
    ]);
    expect(crumbs.map((c) => c.href)).toEqual([
      '/partner/portfolio',
      '/partner/portfolio/org-1',
      null,
    ]);
  });

  it('ссылку раздела можно переопределить — кабинет организации требует ?org=', () => {
    // Без параметра список увёл бы в другую организацию, если их несколько.
    const crumbs = buildCabinetBreadcrumbs(
      'organization',
      '/organization/orders',
      [{ label: 'Заказ №12' }],
      { sectionHref: '/organization/orders?org=org-7' }
    );
    expect(crumbs[0]?.href).toBe('/organization/orders?org=org-7');
  });

  it('неизвестный раздел не выдумывает название — крошка просто не появляется', () => {
    // Такое возможно только при опечатке в вызове; молчаливая «пустая» крошка
    // лучше, чем строка «undefined» на экране.
    const crumbs = buildCabinetBreadcrumbs('admin', '/admin/no-such-section', [
      { label: 'Что-то' },
    ]);
    expect(crumbs).toEqual([{ label: 'Что-то', href: null }]);
  });

  it('пустой хвост даёт только раздел — вызывать так незачем, но экран не падает', () => {
    expect(buildCabinetBreadcrumbs('admin', '/admin/users', [])).toEqual([
      { label: 'Пользователи', href: '/admin/users' },
    ]);
  });

  it('промежуточная крошка без ссылки остаётся без неё, а не получает пустую', () => {
    // Так бывает, когда у промежуточного уровня нет своей страницы: например
    // группа документов внутри организации существует только как заголовок.
    const crumbs = buildCabinetBreadcrumbs('partner', '/partner/portfolio', [
      { label: 'ООО «Ромашка»' },
      { label: 'Документы' },
    ]);
    expect(crumbs[1]).toEqual({ label: 'ООО «Ромашка»', href: null });
    expect(crumbs[2]).toEqual({ label: 'Документы', href: null });
  });
});
