// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderContactPage from '@/app/leader/contacts/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

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

const SESSION = { sub: 'l1', role: 'leader' as const, companyId: 'c1' };
const CONTACT = { id: 'k1', name: 'Иван', mergedIntoId: null };

function open(id: string, sp: Record<string, string> = {}) {
  return LeaderContactPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
}

/**
 * Карточка контакта кабинета руководителя (этап 1 ТЗ 12.09.2026, `У-179`,
 * `У-181`; спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md
 * §3.3): гарды как у менеджера, но `teamMode` всегда `true` (вся компания,
 * `У-101`); редирект объединённого ведёт в СВОЙ кабинет; вкладка — одна, из адреса.
 */
describe('LeaderContactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    getContact.mockResolvedValue({ ok: true, contact: CONTACT });
    listContactTab.mockResolvedValue({ ok: true, items: [], total: 0 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(getContact).not.toHaveBeenCalled();
  });

  it('контакт не найден → notFound', async () => {
    getContact.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(open('k9')).rejects.toThrow('NOTFOUND');
    expect(getContact).toHaveBeenCalledWith({}, SESSION, true, 'k9');
    expect(listContactTab).not.toHaveBeenCalled();
  });

  it('объединённый контакт → redirect на главного в кабинете руководителя', async () => {
    getContact.mockResolvedValue({ ok: true, contact: { ...CONTACT, mergedIntoId: 'k2' } });
    await expect(open('k1')).rejects.toThrow('REDIRECT:/leader/contacts/k2');
  });

  it('отказ сервиса вкладки → notFound', async () => {
    listContactTab.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
  });

  it('teamMode всегда true; ?tab и ?skip уходят в сервис; пропсы экрана', async () => {
    isFeatureEnabled.mockImplementation((flag: string) => flag !== 'deals_pipeline');
    listContactTab.mockResolvedValue({ ok: true, items: [{ id: 'd1' }], total: 3 });
    listContactOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
    const sp = { tab: 'calls', skip: '40' };
    const { container } = await renderServerComponent(open('k1', sp));
    expect(getContact).toHaveBeenCalledWith({}, SESSION, true, 'k1');
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, true, {
      contactId: 'k1',
      tab: 'calls',
      skip: 40,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, true);
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('leader');
    expect(screen.getAttribute('data-contact')).toBe('k1');
    expect(screen.getAttribute('data-tabs')).toBe('dialogs,calls,inbound,orders,history');
    expect(screen.getAttribute('data-active-tab')).toBe('calls');
    expect(screen.getAttribute('data-tab-items')).toBe('d1');
    expect(screen.getAttribute('data-tab-total')).toBe('3');
    expect(screen.getAttribute('data-skip')).toBe('40');
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(screen.getAttribute('data-org-options')).toBe('o1');
    expect(screen.getAttribute('data-messengers')).toBe('true');
  });

  it('без ?tab — «История» и сдвиг 0', async () => {
    const { container } = await renderServerComponent(open('k1'));
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, true, {
      contactId: 'k1',
      tab: 'history',
      skip: 0,
    });
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-active-tab')).toBe('history');
    expect(screen.getAttribute('data-skip')).toBe('0');
  });
});
