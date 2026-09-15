// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessengersPage from '@/app/manager/messengers/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDialogs, listDialogCandidates } = vi.hoisted(() => ({
  listDialogs: vi.fn(),
  listDialogCandidates: vi.fn(),
}));
vi.mock('@/lib/services/messengers/list', () => ({ listDialogs }));
vi.mock('@/lib/services/messengers/start', () => ({ listDialogCandidates }));

vi.mock('@/components/manager/messengers/dialog-list', () => ({
  DialogList: (props: { items: { id: string }[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'dialog-list' },
      props.items.map((i) => i.id).join(',')
    ),
}));
vi.mock('@/components/manager/messengers/new-dialog-button', () => ({
  NewDialogButton: (props: {
    candidates: unknown[];
    preselect?: string;
    autoOpen?: boolean;
    narrowedToOrg?: boolean;
  }) =>
    React.createElement(
      'button',
      {
        'data-preselect': props.preselect ?? 'none',
        // `У-216`: открытие окна отделилось от предвыбора человека — с карточки
        // организации приходят без выбранного человека, но окно открыть надо.
        'data-auto-open': String(Boolean(props.autoOpen)),
        // Сужение до организации меняет текст пустого состояния, поэтому
        // признак обязан дойти до кнопки, а не остаться на сервере.
        'data-narrowed': String(Boolean(props.narrowedToOrg)),
      },
      `Новый диалог (${props.candidates.length})`
    ),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

/**
 * Экран «Мессенджеры» (спека 2026-09-12 §5.1): гейт флага, разбор фильтров,
 * пустое состояние с кнопкой, список и пагинация.
 */
describe('ManagerMessengersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listDialogs.mockResolvedValue({ items: [], total: 0 });
    listDialogCandidates.mockResolvedValue([]);
  });

  it('флаг inbound_messaging выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(ManagerMessengersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('без параметров: первая страница, пустое состояние с главной кнопкой', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({}) })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
    // Третий аргумент — сужение списка кандидатов по организации (`У-216`).
    // Без `?newOrg=` он пустой: список общий, как и был.
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, {});
    expect(container.textContent).toContain('Мессенджеры');
    expect(container.textContent).toContain('Переписка с клиентами');
    expect(container.textContent).toContain('Диалогов пока нет');
    // Кнопка и в шапке, и в пустом состоянии.
    expect(container.textContent?.match(/Новый диалог \(0\)/g)?.length).toBe(2);
  });

  it('фильтры и skip разбираются; мусорные значения отбрасываются', async () => {
    listDialogs.mockResolvedValue({ items: [{ id: 'd1' }, { id: 'd2' }], total: 60 });
    const { container } = await renderServerComponent(
      ManagerMessengersPage({
        searchParams: Promise.resolve({ channel: 'max', status: 'closed', skip: '50' }),
      })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, {
      channel: 'max',
      status: 'closed',
      page: 3,
      pageSize: 25,
    });
    expect(container.querySelector('[data-testid="dialog-list"]')?.textContent).toBe('d1,d2');

    listDialogs.mockClear();
    await renderServerComponent(
      ManagerMessengersPage({
        searchParams: Promise.resolve({ channel: 'sms', status: 'archived', skip: 'abc' }),
      })
    );
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
  });

  it('пусто под фильтром — другое объяснение', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ status: 'open' }) })
    );
    expect(container.textContent).toContain('Под этот фильтр диалогов нет');
  });

  const preselects = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button[data-preselect]')).map((b) =>
      b.getAttribute('data-preselect')
    );
  const autoOpens = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button[data-auto-open]')).map((b) =>
      b.getAttribute('data-auto-open')
    );
  const narrowed = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button[data-narrowed]')).map((b) =>
      b.getAttribute('data-narrowed')
    );

  // Этап 1 ТЗ 12.09.2026 (`У-179`, спека §3.12): «Написать» из карточки контакта.
  it('?new=<contactId> уходит в кнопку предвыбором и открывает окно; без параметра и с пустым — ни того, ни другого', async () => {
    const withId = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ new: 'k1' }) })
    );
    // Кнопка и в шапке, и в пустом состоянии — обе с предвыбором.
    expect(preselects(withId.container)).toEqual(['k1', 'k1']);
    // Человек пришёл по кнопке «Написать» — окно должно открыться само, иначе
    // он нажмёт ещё раз уже здесь.
    expect(autoOpens(withId.container)).toEqual(['true', 'true']);
    // `new` — не фильтр списка: сервис зовётся без него.
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });

    const empty = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ new: '' }) })
    );
    expect(preselects(empty.container)).toEqual(['none', 'none']);
    expect(autoOpens(empty.container)).toEqual(['false', 'false']);

    const absent = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({}) })
    );
    expect(preselects(absent.container)).toEqual(['none', 'none']);
    // Обычный заход на экран окна не открывает — иначе оно лезло бы в глаза
    // каждому, кто просто пришёл почитать диалоги.
    expect(autoOpens(absent.container)).toEqual(['false', 'false']);
  });

  // `У-216`: «Написать первым» с карточки организации.
  it('?newOrg=<orgId> сужает список кандидатов до этой организации и открывает окно без выбранного человека', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ newOrg: 'o1' }) })
    );
    // Сужение уходит в сервис: на карточке организации спрашивают «как
    // связаться с НЕЙ», и справочник на тысячу контактов тут не ответ.
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, { organizationId: 'o1' });
    expect(autoOpens(container)).toEqual(['true', 'true']);
    // Конкретного человека не выбирали — выбор остаётся за сотрудником.
    expect(preselects(container)).toEqual(['none', 'none']);
    // Признак сужения доходит до кнопки: от него зависит текст пустого окна
    // («у этой организации нет людей» вместо «ни у кого нет адреса»).
    expect(narrowed(container)).toEqual(['true', 'true']);
    // И это тоже не фильтр списка диалогов.
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
  });

  it('пустой ?newOrg= сужением не считается — список остаётся общим', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengersPage({ searchParams: Promise.resolve({ newOrg: '' }) })
    );
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, {});
    expect(autoOpens(container)).toEqual(['false', 'false']);
    expect(narrowed(container)).toEqual(['false', 'false']);
  });
});
