import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Подпункты «Сообщений» в меню (этап 7 ТЗ 13.10.2026, `У-313`, `Р-7-1`):
 * у менеджера и руководителя одинаковые; подпункт с выключенным флагом
 * пропадает; в браузер уходит готовый список, а не функция.
 */
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { navItemsFor, navByRole } from '@/lib/navigation/cabinet';

const flags = (on: string[]) =>
  isFeatureEnabled.mockImplementation((f: string) => on.includes(f) || f === 'manager_cabinet');

const messages = (role: 'manager' | 'leader') =>
  navItemsFor(role).find((i) => i.sectionKey === 'messages');

beforeEach(() => isFeatureEnabled.mockReset());

describe('подпункты «Сообщений»', () => {
  it.each(['manager', 'leader'] as const)('%s: три подпункта при включённых флагах', (role) => {
    isFeatureEnabled.mockReturnValue(true);
    const item = messages(role)!;
    expect(item.children).toEqual([
      { key: 'comments', label: 'Комментарии по заказам', href: `/${role}/messages` },
      { key: 'chats', label: 'Чаты с клиентами', href: `/${role}/messages/chats` },
      { key: 'team', label: 'Чаты команды', href: `/${role}/messages/team` },
    ]);
    // Готовые данные: функция-источник в меню, ушедшее в браузер, не остаётся.
    expect(item).not.toHaveProperty('childrenOf');
    expect(() => JSON.stringify(item)).not.toThrow();
  });

  it('выключен chat — нет «Чатов с клиентами»; выключен staff_chat — нет «Чатов команды»', () => {
    flags(['staff_chat']);
    expect(messages('manager')!.children!.map((c) => c.label)).toEqual([
      'Комментарии по заказам',
      'Чаты команды',
    ]);
    flags(['chat']);
    expect(messages('leader')!.children!.map((c) => c.label)).toEqual([
      'Комментарии по заказам',
      'Чаты с клиентами',
    ]);
  });

  it('правило зеркала: подписи подпунктов у менеджера и руководителя совпадают', () => {
    isFeatureEnabled.mockReturnValue(true);
    expect(messages('manager')!.children!.map((c) => c.label)).toEqual(
      messages('leader')!.children!.map((c) => c.label)
    );
  });

  it('у пунктов без подпунктов — ничего лишнего', () => {
    isFeatureEnabled.mockReturnValue(true);
    const orders = navItemsFor('manager').find((i) => i.sectionKey === 'orders')!;
    expect(orders).not.toHaveProperty('children');
    // Сырой реестр хранит источник, а не готовый список.
    const raw = navByRole.manager.find((i) => i.sectionKey === 'messages')!;
    expect(typeof raw.childrenOf).toBe('function');
  });
});
