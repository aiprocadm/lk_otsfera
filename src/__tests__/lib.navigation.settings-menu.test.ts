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
  beforeEach(() => {});

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

    // `У-262`: трёх пунктов обмена в меню больше НЕТ вовсе. Они прятались
    // флагом `settings_hub`, а он был включён везде — то есть не показывались
    // никому; их место заняла карточка хаба «Обмен с 1С» с четырьмя вкладками.
    // Флаг снят, пункты удалены. Прежняя вторая половина проверки («при
    // выключенном хабе они лежат в группе „Финансы“») проверяла ветку, которой
    // больше не существует.
    const exchange = navItemsFor('admin').filter((i) =>
      ['/admin/sync', '/admin/import', '/admin/payments-import'].includes(i.href)
    );
    expect(exchange).toEqual([]);
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

describe('меню руководителя', () => {
  it('при включённом хабе служебные зеркала уезжают под «Настройки»', () => {
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).not.toContain('/leader/roles');
    expect(hrefs).not.toContain('/leader/settings/custom-fields');
    expect(hrefs).not.toContain('/leader/settings/order-statuses');
    expect(hrefs).toContain('/leader/settings');
    expect(splitPinnedItems(navItemsFor('leader')).pinned.map((i) => i.href)).toEqual([
      // `У-111`: пункта-моста в кабинет менеджера здесь больше нет — кабинет
      // переключается в шапке. Внизу остаются только «Настройки» и «Справка».
      '/leader/settings',
      // `У-76` (этап 9): словарь терминов.
      '/help',
    ]);
  });
});
