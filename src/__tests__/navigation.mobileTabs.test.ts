/**
 * Нижняя панель телефона (`У-15`, `У-117`, дефект `Д-40`).
 *
 * Панель строилась по адресам, и это ломалось двумя способами:
 *
 * 1. переименование раздела молча выкидывало вкладку — адрес в списке
 *    переставал совпадать с меню;
 * 2. половина пунктов сидит под opt-in флагами, выключенными по умолчанию, и
 *    панель схлопывалась до **двух** вкладок (`Д-40`).
 *
 * Теперь список — приоритетный, по ключам разделов, с добором из меню.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MOBILE_TABS, mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { navByRole, navItemsFor, type NavItem } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('MOBILE_TABS (У-117)', () => {
  it('страж: каждый ключ вкладки есть в меню своей роли', () => {
    const broken: string[] = [];
    for (const [role, keys] of Object.entries(MOBILE_TABS)) {
      const known = new Set(navByRole[role as keyof typeof navByRole].map((i) => i.sectionKey));
      for (const key of keys) {
        if (!known.has(key)) broken.push(`${role}: ${key}`);
      }
    }
    expect(broken, 'вкладка ведёт на раздел, которого нет в меню роли').toEqual([]);
  });

  it('список приоритетный: запасных пунктов больше четырёх', () => {
    // Ровно четыре ключа означали бы, что один выключенный флаг снова
    // укорачивает панель — ради этого `У-117` и переписан.
    for (const [role, keys] of Object.entries(MOBILE_TABS)) {
      if (role === 'student') continue; // у слушателя один раздел, и это правда
      expect(keys.length, `${role}: запасных пунктов нет`).toBeGreaterThan(4);
    }
  });

  it('заведены все шесть кабинетов', () => {
    expect(Object.keys(MOBILE_TABS).sort()).toEqual(
      ['admin', 'leader', 'manager', 'organization', 'partner', 'student'].sort()
    );
  });
});

describe('mobileTabsFor (У-117)', () => {
  const item = (href: string, sectionKey: NavItem['sectionKey']): NavItem => ({
    href,
    sectionKey,
    label: href,
    iconKey: 'dashboard',
  });

  it('порядок — приоритет панели, а не порядок меню', () => {
    const items = [
      item('/partner/documents', 'documents'),
      item('/partner/dashboard', 'dashboard'),
      item('/partner/deals', 'orders'),
      item('/partner/requests', 'requests'),
    ];
    expect(mobileTabsFor('partner', items).map((t) => t.href)).toEqual([
      '/partner/dashboard',
      '/partner/deals',
      '/partner/requests',
      '/partner/documents',
    ]);
  });

  it('раздел ищется по ключу, а не по адресу — переименование панель не ломает', () => {
    // `У-109` переименует `/partner/deals` в `/partner/orders`. Ключ раздела
    // при этом не меняется, и вкладка обязана остаться на месте.
    const items = [item('/partner/orders', 'orders'), item('/partner/dashboard', 'dashboard')];
    expect(mobileTabsFor('partner', items).map((t) => t.href)).toContain('/partner/orders');
  });

  it('выключенный флагом пункт заменяется следующим по приоритету', () => {
    // «Обращения» выключены — их место занимает «Портфель», следующий в списке.
    const items = [
      item('/partner/dashboard', 'dashboard'),
      item('/partner/deals', 'orders'),
      item('/partner/documents', 'documents'),
      item('/partner/portfolio', 'portfolio'),
    ];
    const tabs = mobileTabsFor('partner', items).map((t) => t.sectionKey);
    expect(tabs).not.toContain('requests');
    expect(tabs).toHaveLength(4);
    expect(tabs).toContain('portfolio');
  });

  it('`Д-40`: панель не схлопывается — добирает обычными пунктами меню', () => {
    // Ни одного запасного из списка нет: панель обязана добрать из меню.
    // Закреплённые внизу стоят В НАЧАЛЕ списка — если бы добор их брал, они
    // вытеснили бы рабочие разделы. Их и так открывает вкладка «Ещё».
    const items = [
      item('/manager/dashboard', 'dashboard'),
      item('/manager/orders', 'orders'),
      item('/manager/settings', 'settings'),
      item('/help', 'help'),
      item('/manager/leads', 'leads'),
      item('/manager/calendar', 'calendar'),
    ];
    items[2]!.pinnedBottom = true;
    items[3]!.pinnedBottom = true;
    const tabs = mobileTabsFor('manager', items);
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.sectionKey)).toEqual(['dashboard', 'orders', 'leads', 'calendar']);
  });

  it('`Д-40` на живом меню: с выключенными opt-in флагами четыре вкладки есть', () => {
    // Именно этот случай и был дефектом: у менеджера «Входящие» и «Задачи»
    // сидят под opt-in флагами, и панель показывала две вкладки из четырёх.
    process.env.FEATURE_MANAGER_CABINET = '1';
    delete process.env.FEATURE_INTAKE_INBOX;
    delete process.env.FEATURE_INTERNAL_TASKS;
    const items = navItemsFor('manager');
    const tabs = mobileTabsFor('manager', items);
    expect(tabs.length, 'панель схлопнулась').toBe(4);
    expect(tabs.map((t) => t.sectionKey)).not.toContain('intake');
  });

  it('пункт «скоро» в панель не берётся — в меню он и не ссылка', () => {
    // Найдено самим гейтом: добор притащил `disabled`-пункт, и мобильная
    // панель сделала из него ссылку на раздел, которого ещё нет. В сайдбаре
    // такой пункт нарисован серым текстом с пометкой «скоро».
    const soon = item('/manager/team', 'team');
    soon.disabled = true;
    const items = [item('/manager/dashboard', 'dashboard'), soon];
    const tabs = mobileTabsFor('manager', items);
    expect(tabs.map((t) => t.href)).toEqual(['/manager/dashboard']);
  });

  it('меньше четырёх доступных разделов — показываем сколько есть', () => {
    const items = [item('/partner/dashboard', 'dashboard'), item('/partner/deals', 'orders')];
    expect(mobileTabsFor('partner', items)).toHaveLength(2);
  });

  it('пустое меню даёт пустой список вкладок', () => {
    expect(mobileTabsFor('admin', [])).toEqual([]);
  });

  it('у слушателя одна вкладка — раздел у него один', () => {
    expect(mobileTabsFor('student', [item('/student', 'learning')])).toHaveLength(1);
  });

  it('неизвестная роль не роняет кабинет — панель просто пустая', () => {
    expect(mobileTabsFor('нет-такой' as never, [item('/x', 'dashboard')])).toEqual([]);
  });
});
