// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminContactPage from '@/app/admin/contacts/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

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

const SESSION = { sub: 'a1', role: 'admin' as const, companyId: 'c1' };
const CONTACT = { id: 'k1', name: 'Иван', mergedIntoId: null };

function open(id: string, sp: Record<string, string> = {}) {
  return AdminContactPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
}

/**
 * Карточка контакта кабинета администратора (этап 1 ТЗ 12.09.2026, `У-179`,
 * `У-181`; спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md
 * §3.3): гарды те же; `teamMode` всегда `false` — пол компании (Model A);
 * редирект объединённого — в кабинет администратора; вкладка — одна, из адреса.
 */
describe('AdminContactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    getContact.mockResolvedValue({ ok: true, contact: CONTACT });
    listContactTab.mockResolvedValue({ ok: true, items: [], total: 0 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts (нет компании) → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
    expect(getContact).not.toHaveBeenCalled();
  });

  it('контакт не найден → notFound', async () => {
    getContact.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(open('k9')).rejects.toThrow('NOTFOUND');
    expect(getContact).toHaveBeenCalledWith({}, SESSION, false, 'k9');
    expect(listContactTab).not.toHaveBeenCalled();
  });

  it('объединённый контакт → redirect на главного в кабинете администратора', async () => {
    getContact.mockResolvedValue({ ok: true, contact: { ...CONTACT, mergedIntoId: 'k2' } });
    await expect(open('k1')).rejects.toThrow('REDIRECT:/admin/contacts/k2');
  });

  it('отказ сервиса вкладки → notFound', async () => {
    listContactTab.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(open('k1')).rejects.toThrow('NOTFOUND');
  });

  it('teamMode всегда false; ?tab и ?skip уходят в сервис; пропсы экрана', async () => {
    isFeatureEnabled.mockImplementation((flag: string) => flag !== 'telephony_mango');
    listContactTab.mockResolvedValue({ ok: true, items: [{ id: 'z1' }, { id: 'z2' }], total: 12 });
    listContactOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
    const sp = { tab: 'deals', skip: '60' };
    const { container } = await renderServerComponent(open('k1', sp));
    expect(getContact).toHaveBeenCalledWith({}, SESSION, false, 'k1');
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, false, {
      contactId: 'k1',
      tab: 'deals',
      skip: 60,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, false);
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('admin');
    expect(screen.getAttribute('data-contact')).toBe('k1');
    expect(screen.getAttribute('data-tabs')).toBe('dialogs,inbound,deals,orders,history');
    expect(screen.getAttribute('data-active-tab')).toBe('deals');
    expect(screen.getAttribute('data-tab-items')).toBe('z1,z2');
    expect(screen.getAttribute('data-tab-total')).toBe('12');
    expect(screen.getAttribute('data-skip')).toBe('60');
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(screen.getAttribute('data-org-options')).toBe('o1');
    expect(screen.getAttribute('data-messengers')).toBe('true');
  });

  it('без ?tab — «История» и сдвиг 0', async () => {
    const { container } = await renderServerComponent(open('k1'));
    expect(listContactTab).toHaveBeenCalledWith({}, SESSION, false, {
      contactId: 'k1',
      tab: 'history',
      skip: 0,
    });
    const screen = container.querySelector('[data-testid="contact-card-screen"]')!;
    expect(screen.getAttribute('data-active-tab')).toBe('history');
    expect(screen.getAttribute('data-skip')).toBe('0');
  });
});
