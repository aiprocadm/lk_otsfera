// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerContactPage from '@/app/manager/contacts/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getContact, listContactTab, listContactOrgOptions, canUseContacts } = vi.hoisted(() => ({
  getContact: vi.fn(),
  listContactTab: vi.fn(),
  listContactOrgOptions: vi.fn(),
  canUseContacts: vi.fn(),
}));
vi.mock('@/lib/services/contacts/get', () => ({ getContact, listContactTab }));
vi.mock('@/lib/services/contacts/orgOptions', () => ({ listContactOrgOptions }));
vi.mock('@/lib/services/contacts/scope', () => ({ canUseContacts }));

// Карточка печатает ключевые пропсы в data-атрибуты — страница проверяется как
// тонкий слой «гард → редирект объединённого → одна вкладка → пропсы».
vi.mock('@/components/manager/contacts/contact-card-screen', () => ({
  ContactCardScreen: (props: {
    cabinet: string;
    contact: { id: string };
    tabs: { key: string }[];
    activeTab: string;
    tabItems: { id: string }[];
    tabTotal: number;
    skip: number;
    searchParams: unknown;
    orgOptions: { id: string }[];
    messengersEnabled: boolean;
  }) =>
    React.createElement('div', {
      'data-testid': 'contact-card-screen',
      'data-cabinet': props.cabinet,
      'data-contact': props.contact.id,
      'data-tabs': props.tabs.map((t) => t.key).join(','),
      'data-active-tab': props.activeTab,
      'data-tab-items': props.tabItems.map((i) => i.id).join(','),
      'data-tab-total': String(props.tabTotal),
      'data-skip': String(props.skip),
      'data-sp': JSON.stringify(props.searchParams),
      'data-org-options': props.orgOptions.map((o) => o.id).join(','),
      'data-messengers': String(props.messengersEnabled),
    }),
}));

const SESSION = { sub: 'm1', role: 'manager' as const, companyId: 'c1' };
const CONTACT = { id: 'k1', name: 'Иван', mergedIntoId: null };
const ALL_TABS = 'dialogs,calls,inbound,deals,orders,history';

function open(id: string, sp: Record<string, string> = {}) {
  return ManagerContactPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
}

/**
 * Карточка контакта кабинета менеджера (этап 1 ТЗ 12.09.2026, `У-179`, `У-181`;
 * спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * флаг и право — два гарда до сервисов; `teamMode` свежим из базы; объединённый
 * контакт редиректит на главного; грузится одна вкладка — та, что в адресе
 * (неизвестная → «История»), со сдвигом; отказ сервиса вкладки — 404.
 */
describe('ManagerContactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    getCompanyTeamVisibility.mockResolvedValue(true);
    getContact.mockResolvedValue({ ok: true, contact: CONTACT });
    listContactTab.mockResolvedValue({ ok: true, items: [], total: 0 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(requireManager).not.toHaveBeenCalled();
    expect(getContact).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(canUseContacts).toHaveBeenCalledWith(SESSION);
    expect(getContact).not.toHaveBeenCalled();
  });

  it('контакт не найден или чужой → notFound; вкладка не грузится', async () => {
    getContact.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(open('k9')).rejects.toThrow('NOTFOUND');
    expect(getContact).toHaveBeenCalledWith({}, SESSION, true, 'k9');
    expect(listContactTab).not.toHaveBeenCalled();
  });

  it('объединённый контакт → redirect на главного в своём кабинете', async () => {
    getContact.mockResolvedValue({ ok: true, contact: { ...CONTACT, mergedIntoId: 'k2' } });
    await expect(open('k1')).rejects.toThrow('REDIRECT:/manager/contacts/k2');
    expect(listContactTab).not.toHaveBeenCalled();
  });

  it('отказ сервиса вкладки → notFound', async () => {
    listContactTab.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
  });

  it('без параметров: teamMode из базы, вкладка «История», сдвиг 0, пропсы экрана', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    listContactTab.mockResolvedValue({ ok: true, items: [{ id: 'a1' }, { id: 'a2' }], total: 7 });
    listContactOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
    const { container } = await renderServerComponent(open('k1'));
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(getContact).toHaveBeenCalledWith({}, SESSION, false, 'k1');
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, false, {
      contactId: 'k1',
      tab: 'history',
      skip: 0,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, false);
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('manager');
    expect(screen.getAttribute('data-contact')).toBe('k1');
    expect(screen.getAttribute('data-tabs')).toBe(ALL_TABS);
    expect(screen.getAttribute('data-active-tab')).toBe('history');
    expect(screen.getAttribute('data-tab-items')).toBe('a1,a2');
    expect(screen.getAttribute('data-tab-total')).toBe('7');
    expect(screen.getAttribute('data-skip')).toBe('0');
    expect(screen.getAttribute('data-sp')).toBe('{}');
    expect(screen.getAttribute('data-org-options')).toBe('o1');
    expect(screen.getAttribute('data-messengers')).toBe('true');
  });

  it('?tab и ?skip уходят в сервис вкладки; вкладки без флага исчезают, «Написать» гаснет', async () => {
    isFeatureEnabled.mockImplementation((flag: string) => flag !== 'inbound_messaging');
    const sp = { tab: 'orders', skip: '20' };
    const { container } = await renderServerComponent(open('k1', sp));
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, true, {
      contactId: 'k1',
      tab: 'orders',
      skip: 20,
    });
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-tabs')).toBe('calls,deals,orders,history');
    expect(screen.getAttribute('data-active-tab')).toBe('orders');
    expect(screen.getAttribute('data-skip')).toBe('20');
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(screen.getAttribute('data-messengers')).toBe('false');
  });

  it('неизвестная вкладка в адресе → последняя из реестра («История»)', async () => {
    await renderServerComponent(open('k1', { tab: 'tasks' }));
    expect(listContactTab).toHaveBeenCalledWith(
      {},
      SESSION,
      true,
      expect.objectContaining({ tab: 'history' })
    );
  });
});
