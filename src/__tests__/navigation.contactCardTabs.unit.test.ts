import { describe, it, expect, vi } from 'vitest';
import type { FeatureFlag } from '@/lib/featureFlags';
import { contactCardTabsFor } from '@/lib/navigation/contactCardTabs';

/**
 * Реестр вкладок карточки контакта (этап 1 ТЗ 12.09.2026, `У-179`, `У-74`;
 * спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * вкладки разделов под флагами (`inbound_messaging`, `telephony_mango`,
 * `deals_pipeline`) исчезают вместе с разделом, «Заказы» и «История» есть
 * всегда; порядок и подписи — по глоссарию.
 */
describe('contactCardTabsFor', () => {
  it('все флаги включены — шесть вкладок в порядке реестра с подписями', () => {
    const tabs = contactCardTabsFor({ flags: () => true });
    expect(tabs.map((t) => [t.key, t.label])).toEqual([
      ['dialogs', 'Диалоги'],
      ['calls', 'Звонки'],
      ['inbound', 'Входящие письма'],
      ['deals', 'Сделки'],
      ['orders', 'Заказы'],
      ['history', 'История'],
    ]);
  });

  it('все флаги выключены — остаются «Заказы» и «История»', () => {
    expect(contactCardTabsFor({ flags: () => false }).map((t) => t.key)).toEqual([
      'orders',
      'history',
    ]);
  });

  it('фильтр по флагам: спрашивает только у вкладок с флагом, по их флагу', () => {
    const flags = vi.fn((flag: FeatureFlag) => flag === 'telephony_mango');
    const tabs = contactCardTabsFor({ flags });
    expect(tabs.map((t) => t.key)).toEqual(['calls', 'orders', 'history']);
    expect(flags.mock.calls.map((c) => c[0])).toEqual([
      'inbound_messaging',
      'telephony_mango',
      'inbound_messaging',
      'deals_pipeline',
    ]);
  });

  it('вкладки под одним флагом включаются и выключаются вместе', () => {
    const only = (name: FeatureFlag) =>
      contactCardTabsFor({ flags: (f) => f === name }).map((t) => t.key);
    expect(only('inbound_messaging')).toEqual(['dialogs', 'inbound', 'orders', 'history']);
    expect(only('deals_pipeline')).toEqual(['deals', 'orders', 'history']);
  });
});
