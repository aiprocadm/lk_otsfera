import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { splitPinnedItems } from '@/lib/navigation/groupItems';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * Состав меню под флагом `settings_hub` (ТЗ раздел 2 и критерий приёмки 1):
 * включён — девяти служебных пунктов нет, вместо них один закреплённый
 * «Настройки»; выключен — меню ровно прежнее.
 */
const ORIGINAL_ENV = { ...process.env };

/** Все старые адреса разделов, которые ТЗ требует убрать из основного меню. */
const LEGACY_ADMIN_HREFS = SETTINGS_SECTIONS.flatMap((s) =>
  s.legacyHrefs.map((l) => l.from)
).filter((href) => href.startsWith('/admin'));

function enableEverything() {
  // Меню админа частично под opt-in флагами: включаем их, чтобы сравнивать
  // полный состав, а не обрезанный.
  process.env.FEATURE_ROLE_CONSTRUCTOR = '1';
  process.env.FEATURE_ENROLLMENT_REQUESTS = '1';
  process.env.FEATURE_CLIENT_REQUESTS = '1';
  process.env.FEATURE_INTAKE_INBOX = '1';
  process.env.FEATURE_LEADER_CABINET = '1';
  process.env.FEATURE_MANAGER_CABINET = '1';
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  enableEverything();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('меню админа при включённом хабе', () => {
  beforeEach(() => {
    process.env.FEATURE_SETTINGS_HUB = '1';
  });

  it('ни одного из старых служебных пунктов не осталось', () => {
    const hrefs = navItemsFor('admin').map((i) => i.href);
    for (const legacy of LEGACY_ADMIN_HREFS) {
      expect(hrefs).not.toContain(legacy);
    }
  });

  it('«Настройки» ровно один пункт и он закреплён внизу', () => {
    const items = navItemsFor('admin');
    const settings = items.filter((i) => i.href === '/admin/settings');
    expect(settings).toHaveLength(1);
    // `У-76` (этап 9): рядом с «Настройками» внизу закреплена «Справка».
    expect(splitPinnedItems(items).pinned.map((i) => i.href)).toEqual(['/admin/settings', '/help']);
  });

  it('`У-113`: группы «Обмен с 1С» больше нет — её пункты живут в «Финансах»', () => {
    // Отдельная группа под обмен была четвёртой в меню админа и не встречалась
    // ни у менеджера, ни у руководителя. Порядок групп теперь общий.
    // При включённом хабе трёх пунктов обмена в меню нет вовсе — их заменяет
    // карточка хаба. Проверяем и это, и то, что при выключенном хабе они лежат
    // в общей группе «Финансы», а не в своей.
    expect(navItemsFor('admin').map((i) => i.group)).not.toContain('Обмен с 1С');

    process.env.FEATURE_SETTINGS_HUB = '0';
    const exchange = navItemsFor('admin').filter((i) =>
      ['/admin/sync', '/admin/import', '/admin/payments-import'].includes(i.href)
    );
    expect(exchange.length).toBe(3);
    for (const item of exchange) expect(item.group).toBe('Финансы');
  });

  it('операционные разделы остаются на месте', () => {
    const hrefs = navItemsFor('admin').map((i) => i.href);
    for (const href of [
      '/admin/dashboard',
      '/admin/organizations',
      '/admin/partners',
      '/admin/users',
      '/admin/documents',
      '/admin/finance',
      '/admin/commission-statements',
      '/admin/training-directions',
    ]) {
      expect(hrefs).toContain(href);
    }
  });
});

describe('меню админа при выключенном хабе', () => {
  beforeEach(() => {
    process.env.FEATURE_SETTINGS_HUB = '0';
  });

  it('все прежние пункты на месте — раскатка обратима', () => {
    const hrefs = navItemsFor('admin').map((i) => i.href);
    for (const legacy of LEGACY_ADMIN_HREFS) {
      expect(hrefs).toContain(legacy);
    }
  });
});

describe('меню руководителя', () => {
  it('при включённом хабе служебные зеркала уезжают под «Настройки»', () => {
    process.env.FEATURE_SETTINGS_HUB = '1';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).not.toContain('/leader/roles');
    expect(hrefs).not.toContain('/leader/settings/custom-fields');
    expect(hrefs).not.toContain('/leader/settings/order-statuses');
    expect(hrefs).toContain('/leader/settings');
    expect(splitPinnedItems(navItemsFor('leader')).pinned.map((i) => i.href)).toEqual([
      // `У-114`: пункт-мост в кабинет менеджера — переключение кабинета, а не
      // раздел работы, поэтому он внизу. В PR-3 этапа 3 его заменит
      // переключатель в шапке (`У-111`), и строка отсюда уйдёт.
      '/manager/dashboard',
      '/leader/settings',
      // `У-76` (этап 9): словарь терминов.
      '/help',
    ]);
  });

  it('при выключенном хабе зеркала на месте', () => {
    process.env.FEATURE_SETTINGS_HUB = '0';
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).toContain('/leader/roles');
    expect(hrefs).toContain('/leader/settings/custom-fields');
    expect(hrefs).toContain('/leader/settings/order-statuses');
  });
});
