import { describe, expect, it } from 'vitest';

import {
  ORG_CARD_TABS,
  orgCardTabsFor,
  type OrgCardTabKey,
} from '@/lib/navigation/orgCardTabs';
import { NAV_ICONS } from '@/lib/navigation/icons';

/**
 * `У-95`: вкладки карточки организации живут в ОДНОМ реестре, а состав в
 * кабинете — фильтр этого реестра. До этапа 2 у менеджера был свой список из
 * 12 вкладок в компоненте, у партнёра свой из 5, у админа вкладок не было
 * вовсе — отсюда «Заявки» у одного и «Заказы» у другого про один и тот же
 * объект.
 */
describe('реестр вкладок карточки организации (У-95)', () => {
  it('ключ вкладки уникален, название и значок заданы один раз', () => {
    const keys = ORG_CARD_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tab of ORG_CARD_TABS) {
      expect(tab.label.trim()).not.toBe('');
      expect(NAV_ICONS[tab.iconKey]).toBeTruthy();
    }
  });

  it('одинаковый ключ ⇒ одинаковые название и значок во всех кабинетах', () => {
    const cabinets = ['admin', 'leader', 'manager', 'partner', 'organization'] as const;
    const seen = new Map<OrgCardTabKey, { label: string; iconKey: string }>();
    for (const cabinet of cabinets) {
      for (const tab of orgCardTabsFor(cabinet, { flags: () => true })) {
        const before = seen.get(tab.key);
        if (before) {
          expect({ key: tab.key, ...before }).toEqual({
            key: tab.key,
            label: tab.label,
            iconKey: tab.iconKey,
          });
        } else {
          seen.set(tab.key, { label: tab.label, iconKey: tab.iconKey });
        }
      }
    }
    // Проверка имеет смысл, только если кабинеты реально делят вкладки.
    expect(seen.size).toBeGreaterThan(5);
  });

  it('порядок вкладок общий: в кабинете он подпоследовательность реестра', () => {
    const order = ORG_CARD_TABS.map((t) => t.key);
    for (const cabinet of ['admin', 'leader', 'manager', 'partner', 'organization'] as const) {
      const got = orgCardTabsFor(cabinet, { flags: () => true }).map((t) => t.key);
      const positions = got.map((k) => order.indexOf(k));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(positions.every((p) => p >= 0)).toBe(true);
    }
  });

  it('`У-96`: состав и названия — из глоссария, а не из старой терминологии', () => {
    const byKey = new Map(ORG_CARD_TABS.map((t) => [t.key, t.label]));
    expect(byKey.get('orders')).toBe('Заказы');
    expect(byKey.get('requests')).toBe('Обращения');
    expect(byKey.get('inbound')).toBe('Входящие письма');
    expect(byKey.get('settings')).toBe('Настройки');
    // `У-97`: «Сотрудники» — люди организации во всех кабинетах.
    expect(byKey.get('employees')).toBe('Сотрудники');
    // Дореформенных подписей в реестре быть не должно.
    const labels = [...byKey.values()];
    expect(labels).not.toContain('Заявки');
    expect(labels).not.toContain('Заявки клиентов');
    expect(labels).not.toContain('Реквизиты');
  });

  it('`У-96`: у партнёра нет вкладок внутреннего контура и оплат', () => {
    const partner = orgCardTabsFor('partner', { flags: () => true }).map((t) => t.key);
    for (const forbidden of ['payments', 'leads', 'deals', 'calls', 'inbound']) {
      expect(partner).not.toContain(forbidden as OrgCardTabKey);
    }
    // `У-96`: «История» — журнал действий учебного центра (кто и что менял).
    // Партнёру он не положен; сводку по клиенту ему даёт «Обзор».
    expect(partner).not.toContain('history');
    // Но общие вкладки у него есть — иначе фильтр вырезал бы всё.
    expect(partner).toContain('overview');
    expect(partner).toContain('employees');
    expect(partner).toContain('documents');
  });

  it('заказчик видит свою организацию без служебных вкладок ЦО', () => {
    const org = orgCardTabsFor('organization', { flags: () => true }).map((t) => t.key);
    expect(org).toContain('employees');
    expect(org).toContain('settings');
    for (const forbidden of ['leads', 'deals', 'calls', 'inbound', 'payments']) {
      expect(org).not.toContain(forbidden as OrgCardTabKey);
    }
  });

  it('выключенный флаг убирает вкладку у всех кабинетов сразу', () => {
    const withDeals = orgCardTabsFor('manager', { flags: () => true }).map((t) => t.key);
    const without = orgCardTabsFor('manager', { flags: (f) => f !== 'deals_pipeline' }).map(
      (t) => t.key
    );
    expect(withDeals).toContain('deals');
    expect(without).not.toContain('deals');
  });

  it('«Комментарии» флагом не гейтятся — это разговор по заказу, а не чат (У-96)', () => {
    // Вкладка называлась «Переписка» и стояла под флагом `chat`, хотя
    // показывала `Comment`: при выключенном чате человек терял и комментарии.
    const off = orgCardTabsFor('manager', { flags: () => false });
    expect(off.map((t) => t.key)).toContain('comments');
    expect(ORG_CARD_TABS.find((t) => t.key === 'comments')?.flag).toBeUndefined();
  });

  it('значок вкладки — из семантического реестра, а не подобран на глаз (У-9)', () => {
    for (const tab of ORG_CARD_TABS) {
      expect(Object.keys(NAV_ICONS)).toContain(tab.iconKey);
    }
    // `У-9`: вкладка «Сотрудники» несёт тот же значок, что и одноимённый
    // пункт меню — одно название, один знак.
    expect(ORG_CARD_TABS.find((t) => t.key === 'employees')?.iconKey).toBe('employees');
  });
});
