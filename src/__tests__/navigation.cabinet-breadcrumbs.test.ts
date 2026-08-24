import { describe, it, expect } from 'vitest';
import {
  buildCabinetBreadcrumbs,
  buildOrgEmployeeBreadcrumbs,
} from '@/lib/navigation/breadcrumbs';
import { orgCardTabLabel } from '@/lib/navigation/orgCardTabs';
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


/**
 * `У-97`: карточка сотрудника лежит внутри карточки организации, и путь до
 * неё обязан это показывать. Раньше карточка менеджера ссылалась на снятый
 * раздел «Сотрудники» — крошка молча исчезала, и человек оставался на экране
 * с одной фамилией и без пути назад.
 */
describe('buildOrgEmployeeBreadcrumbs (У-97)', () => {
  const crumbs = buildOrgEmployeeBreadcrumbs('manager', '/manager/organizations', {
    orgCardHref: '/manager/organizations/org-1',
    orgName: 'ООО «Ромашка»',
    employeeName: 'Иванов Иван',
  });

  it('путь целиком: раздел → организация → сотрудники → человек', () => {
    expect(crumbs.map((c) => c.label)).toEqual([
      'Организации',
      'ООО «Ромашка»',
      orgCardTabLabel('employees'),
      'Иванов Иван',
    ]);
  });

  it('крошка «Сотрудники» открывает ту самую вкладку карточки', () => {
    expect(crumbs[2]!.href).toBe('/manager/organizations/org-1?tab=employees');
  });

  it('подпись вкладки берётся из реестра, а не пишется строкой', () => {
    // Переименование вкладки в реестре обязано менять и крошку.
    expect(crumbs[2]!.label).toBe(orgCardTabLabel('employees'));
  });

  it('последняя крошка — текущая страница, ссылки не имеет', () => {
    expect(crumbs[3]!.href).toBeNull();
  });

  it('у партнёра свой раздел, но структура пути та же', () => {
    const partner = buildOrgEmployeeBreadcrumbs('partner', '/partner/portfolio', {
      orgCardHref: '/partner/portfolio/org-1',
      orgName: 'ООО «Ромашка»',
      employeeName: 'Иванов Иван',
    });
    expect(partner).toHaveLength(4);
    expect(partner[2]!.href).toBe('/partner/portfolio/org-1?tab=employees');
  });
});
