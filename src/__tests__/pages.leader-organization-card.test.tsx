// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const { getFieldsForEntity } = vi.hoisted(() => ({ getFieldsForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity }));

// `У-166`: блок КП грузит сервис — здесь он подменён, страница ходит в базу
// только через него.
const { listOrganizationProposals } = vi.hoisted(() => ({ listOrganizationProposals: vi.fn() }));
vi.mock('@/lib/services/documents/proposalBlocks', () => ({ listOrganizationProposals }));

const { getAutoCreatedFrom1C } = vi.hoisted(() => ({ getAutoCreatedFrom1C: vi.fn() }));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => false) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-97`: список сотрудников ходит в базу — сервис и секция подменены.
const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));
vi.mock('@/components/organization/org-employees-section', () => ({
  OrgEmployeesSection: (p: { total: number; skip: number; basePath: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-employees', 'data-base': p.basePath, 'data-skip': p.skip },
      `сотрудников:${p.total}`
    ),
}));

// Этап 1 ТЗ 12.09.2026 (спека §3.7–§3.8): вкладки «Контакты» (`У-182`),
// «Заметки» (`У-183`), «История» (`У-184`) и блок «Важное» ходят в базу только
// через сервисы — здесь они подменены. У руководителя охват команды — вся
// компания, поэтому `teamMode` страница отдаёт константой `true`.
const { listContacts } = vi.hoisted(() => ({ listContacts: vi.fn() }));
vi.mock('@/lib/services/contacts/list', () => ({ listContacts, CONTACT_LIST_PAGE: 50 }));
const { listContactOrgOptions } = vi.hoisted(() => ({ listContactOrgOptions: vi.fn() }));
vi.mock('@/lib/services/contacts/orgOptions', () => ({ listContactOrgOptions }));
const { listOrganizationNotes } = vi.hoisted(() => ({ listOrganizationNotes: vi.fn() }));
vi.mock('@/lib/services/organizationNotes/list', () => ({ listOrganizationNotes }));
const { listColleagues } = vi.hoisted(() => ({ listColleagues: vi.fn() }));
vi.mock('@/lib/services/staffChat/mentions', () => ({ listColleagues }));
// Предикат типа и список пилюль — настоящие: страница обязана разбирать
// `?type=` тем же правилом, что и сервис; подменён только поход в базу.
const { listOrgHistory } = vi.hoisted(() => ({ listOrgHistory: vi.fn() }));
vi.mock('@/lib/services/organization/orgHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/organization/orgHistory')>()),
  listOrgHistory,
}));

// Четыре секции этапа 1 — заглушки, печатающие ключевые пропсы: страница
// отвечает за то, ЧТО передать, сами секции проверены своими тестами.
vi.mock('@/components/organization/org-contacts-section', () => ({
  OrgContactsSection: (p: {
    cabinet: string;
    organizationId: string;
    items: unknown[];
    total: number;
    skip: number;
    basePath: string;
    orgOptions: Array<{ id: string }>;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'org-contacts',
        'data-cabinet': p.cabinet,
        'data-org': p.organizationId,
        'data-total': p.total,
        'data-skip': p.skip,
        'data-base': p.basePath,
      },
      `контактов:${p.items.length} организаций:${p.orgOptions.map((o) => o.id).join(',')}`
    ),
}));
vi.mock('@/components/organization/org-notes-section', () => ({
  OrgNotesSection: (p: {
    organizationId: string;
    pinned: Array<{ id: string }>;
    notes: Array<{ id: string }>;
    colleagues: Array<{ id: string }>;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-notes', 'data-org': p.organizationId },
      `закреплено:${p.pinned.map((n) => n.id).join(',')} заметки:${p.notes
        .map((n) => n.id)
        .join(',')} коллеги:${p.colleagues.map((c) => c.id).join(',')}`
    ),
}));
vi.mock('@/components/organization/org-history-section', () => ({
  OrgHistorySection: (p: {
    cabinet: string;
    basePath: string;
    types: Array<{ key: string }>;
    activeType: string | null;
    items: unknown[];
    total: number;
    skip: number;
    mode: string;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'org-history',
        'data-cabinet': p.cabinet,
        'data-base': p.basePath,
        'data-total': p.total,
        'data-skip': p.skip,
        'data-mode': p.mode,
        'data-active-type': p.activeType ?? 'null',
      },
      `событий:${p.items.length} типы:${p.types.map((t) => t.key).join(',')}`
    ),
}));
vi.mock('@/components/organization/pinned-notes-block', () => ({
  PinnedNotesBlock: (p: { notes: Array<{ id: string }>; notesHref: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'pinned-notes', 'data-href': p.notesHref },
      `важное:${p.notes.map((n) => n.id).join(',')}`
    ),
}));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: {
    activeTab: string;
    tabs: Array<{ key: string }>;
    employees?: React.ReactNode;
    settings?: React.ReactNode;
    documentsAction?: React.ReactNode;
    proposals?: React.ReactNode;
    contacts?: React.ReactNode;
    notes?: React.ReactNode;
    history?: React.ReactNode;
    overviewExtra?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-card', 'data-active': props.activeTab },
      props.tabs.map((t) => t.key).join(','),
      props.employees,
      props.settings,
      props.documentsAction,
      props.proposals,
      props.contacts,
      props.notes,
      props.history,
      props.overviewExtra
    ),
}));
// `У-99`: настройки собирает отдельный серверный компонент — он ходит в
// сервисы, поэтому здесь его подменяем.
vi.mock('@/components/organization/org-staff-settings', () => ({
  OrgStaffSettings: (p: { cabinet: string }) =>
    React.createElement('div', null, `НАСТРОЙКИ:${p.cabinet}`),
}));
vi.mock('@/components/students/add-student-dialog', () => ({
  AddStudentDialog: () => React.createElement('div', { 'data-testid': 'add-student' }),
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => React.createElement('div', { 'data-testid': 'custom-fields' }),
}));
vi.mock('@/components/organization/auto-created-badge', () => ({
  AutoCreatedBadge: () => React.createElement('div', { 'data-testid': 'auto-created' }),
}));

import LeaderOrgDetailPage from '@/app/leader/organizations/[id]/page';

const SESSION = { sub: 'leader-1', role: 'leader' as const, companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManagerLeader.mockResolvedValue(SESSION);
  getOrganizationCard.mockResolvedValue({ id: 'org-1', name: 'ООО «Ромашка»' });
  getFieldsForEntity.mockResolvedValue([]);
  getAutoCreatedFrom1C.mockResolvedValue(null);
  listOrganizationProposals.mockResolvedValue({ ok: true, rows: [] });
  isFeatureEnabled.mockReturnValue(false);
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 3, canWrite: true });
  // Этап 1: доступ есть, данных нет — вкладки не падают, проверки ниже подменяют точечно.
  listContacts.mockResolvedValue({ ok: true, items: [], total: 0 });
  listContactOrgOptions.mockResolvedValue([]);
  listOrganizationNotes.mockResolvedValue({ ok: true, notes: [], pinned: [] });
  listColleagues.mockResolvedValue({ ok: true, rows: [] });
  listOrgHistory.mockResolvedValue({ ok: true, items: [], total: 0, mode: 'top' });
});

/**
 * `У-101`: у руководителя своя карточка организации. До этапа 2 его уводило в
 * `/manager/organizations/[id]` — чужой кабинет с крошками в чужой список.
 */
describe('LeaderOrgDetailPage (У-101)', () => {
  it('гард руководителя и карточка из сервиса со скоупом компании', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(getOrganizationCard).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(container.querySelector('[data-testid="org-card"]')).not.toBeNull();
  });

  it('крошки ведут в СВОЙ список организаций, а не в кабинет менеджера', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/leader/organizations');
    expect(hrefs.some((h) => h?.startsWith('/manager/'))).toBe(false);
  });

  it('чужая организация — 404, существование не раскрывается', async () => {
    getOrganizationCard.mockResolvedValue(null);
    await expect(
      renderServerComponent(
        LeaderOrgDetailPage({
          params: Promise.resolve({ id: 'foreign' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('состав вкладок — фильтр общего реестра: выключенные флаги вкладок не дают', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    const keys = container.querySelector('[data-testid="org-card"]')!.textContent!.split(',');
    expect(keys).toContain('orders');
    // Флаги выключены — вкладок под флагом нет ни одной.
    for (const gated of ['threads', 'calls', 'requests', 'deals', 'certificates']) {
      expect(keys).not.toContain(gated);
    }
  });

  it('вкладка из адреса подхватывается, мусор откатывается к «Обзору»', async () => {
    const ok = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(
      ok.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('documents');

    const junk = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'нет-такой' }),
      })
    );
    expect(
      junk.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('overview');
  });
});

describe('LeaderOrgDetailPage — вкладка «Настройки» (У-99)', () => {
  it('на вкладке настроек подключает сборщик кабинета руководителя', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'settings' }),
      })
    );
    expect(container.textContent).toContain('НАСТРОЙКИ:leader');
    expect(getFieldsForEntity).toHaveBeenCalled();
  });

  it('на других вкладках поля не грузятся (У-64: под вкладками ничего лишнего)', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(container.textContent).not.toContain('НАСТРОЙКИ:');
    expect(getFieldsForEntity).not.toHaveBeenCalled();
  });

  /**
   * `У-145`: у руководителя та же кнопка и то же условие, что у менеджера —
   * зеркальность кабинетов (§0.2), а не своя ветка на каждый кабинет.
   */
  it('«Создать документ» приходит во вкладку «Документы» при включённой генерации', async () => {
    // Мок объявлен без параметров (`vi.fn(() => false)`) — включаем все флаги
    // разом: вкладки от этого только прибавляются, а проверяем мы кнопку.
    isFeatureEnabled.mockReturnValue(true);
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).toContain('Создать документ');
  });

  it('выключенная генерация документов кнопку не даёт', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).not.toContain('Создать документ');
  });

  /**
   * `У-166`: карточка организации показывает КП отдельным блоком — как и
   * карточка сделки. У руководителя ссылка ведёт в ЕГО раздел документов:
   * увести человека в чужой кабинет значило бы сломать «где я» (§15).
   */
  it('блок КП рисуется во вкладке «Документы» и ведёт в свой раздел', async () => {
    listOrganizationProposals.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'kp-1',
          number: 'КП-7',
          status: 'sent',
          amountGross: '120000.00',
          sentAt: new Date('2026-09-01T00:00:00Z'),
          validUntil: new Date('2026-09-10T00:00:00Z'),
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
    });
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).toContain('Коммерческие предложения');
    expect(container.querySelector('a[href="/leader/documents/kp-1"]')).toBeTruthy();
    expect(listOrganizationProposals).toHaveBeenCalledWith({}, SESSION, {
      organizationId: 'org-1',
    });
  });

  it('на других вкладках за предложениями не ходим, а отказ сервиса блок не рисует', async () => {
    // Лишний запрос на «Обзоре» — плата за то, чего человек не открывал.
    await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(listOrganizationProposals).not.toHaveBeenCalled();

    listOrganizationProposals.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).not.toContain('Коммерческие предложения');
  });
});

// ─── `У-97`: вкладка «Сотрудники» карточки ───────────────────────────────────

describe('LeaderOrgDetailPage — вкладка «Сотрудники» (У-97)', () => {
  it('список грузится только на своей вкладке, с поиском и смещением из адреса', async () => {
    await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(listOrgCardEmployees).not.toHaveBeenCalled();

    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'employees', q: 'Иван', skip: '25' }),
      })
    );
    expect(listOrgCardEmployees).toHaveBeenCalledWith({}, SESSION, {
      orgId: 'org-1',
      q: 'Иван',
      skip: 25,
    });
    const section = container.querySelector('[data-testid="org-employees"]')!;
    // Ссылки постраничности — в СВОЙ кабинет, а не в менеджерский (`У-101`).
    expect(section.getAttribute('data-base')).toBe('/leader/organizations/org-1');
    expect(section.getAttribute('data-skip')).toBe('25');
    expect(section.textContent).toBe('сотрудников:3');
  });

  it('мусорное смещение — с начала, пустой поиск не передаётся', async () => {
    await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'employees', skip: 'abc', q: '' }),
      })
    );
    expect(listOrgCardEmployees).toHaveBeenCalledWith({}, SESSION, { orgId: 'org-1', skip: 0 });
  });
});

// ─── Этап 1 ТЗ 12.09.2026: «Контакты», «Заметки», «История», «Важное» ─────────

/**
 * Спека §3.7–§3.8: у руководителя те же вкладки тем же компонентом (`Р-23`,
 * правило зеркала §0.2); отличие одно — охват контактов всегда командный
 * (`teamMode=true`), потому что руководитель видит всю компанию.
 */
describe('LeaderOrgDetailPage — этап 1 ТЗ 12.09.2026 (У-182…У-184)', () => {
  const render = (sp: Record<string, string | string[]> = {}) =>
    renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve(sp),
      })
    );

  it('«Обзор»: закреплённые заметки уходят в блок «Важное», остальные сервисы не трогаем', async () => {
    listOrganizationNotes.mockResolvedValue({
      ok: true,
      notes: [{ id: 'n2' }],
      pinned: [{ id: 'n1' }],
    });
    const { container } = await render();

    expect(listOrganizationNotes).toHaveBeenCalledWith({}, SESSION, 'org-1');
    const block = container.querySelector('[data-testid="pinned-notes"]')!;
    expect(block.textContent).toBe('важное:n1');
    expect(block.getAttribute('data-href')).toBe('/leader/organizations/org-1?tab=notes');
    expect(container.querySelector('[data-testid="org-notes"]')).toBeNull();
    expect(listColleagues).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
    expect(listContactOrgOptions).not.toHaveBeenCalled();
    expect(listOrgHistory).not.toHaveBeenCalled();
  });

  it('«Заметки»: секция получает закреплённые, остальные и коллег для упоминаний', async () => {
    listOrganizationNotes.mockResolvedValue({
      ok: true,
      notes: [{ id: 'n2' }, { id: 'n3' }],
      pinned: [{ id: 'n1' }],
    });
    listColleagues.mockResolvedValue({
      ok: true,
      rows: [
        { id: 'u1', name: 'Иван' },
        { id: 'u2', name: 'Пётр' },
      ],
    });
    const { container } = await render({ tab: 'notes' });

    expect(listColleagues).toHaveBeenCalledWith({}, SESSION);
    const section = container.querySelector('[data-testid="org-notes"]')!;
    expect(section.getAttribute('data-org')).toBe('org-1');
    expect(section.textContent).toBe('закреплено:n1 заметки:n2,n3 коллеги:u1,u2');
    expect(container.querySelector('[data-testid="pinned-notes"]')).toBeNull();
  });

  it('«Контакты»: охват всегда командный (teamMode=true), страница списка — из смещения', async () => {
    // Вкладка живёт под флагом справочника контактов; мок без параметров —
    // включаем все флаги разом, лишние вкладки проверке не мешают.
    isFeatureEnabled.mockReturnValue(true);
    listContacts.mockResolvedValue({ ok: true, items: [{ id: 'k1' }, { id: 'k2' }], total: 52 });
    listContactOrgOptions.mockResolvedValue([
      { id: 'org-1', name: 'Org' },
      { id: 'org-2', name: 'Другая' },
    ]);
    const { container } = await render({ tab: 'contacts', skip: '50' });

    // skip=50 при странице в 50 контактов — это вторая страница.
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, true, {
      organizationId: 'org-1',
      page: 2,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, true);
    const section = container.querySelector('[data-testid="org-contacts"]')!;
    expect(section.getAttribute('data-cabinet')).toBe('leader');
    expect(section.getAttribute('data-org')).toBe('org-1');
    expect(section.getAttribute('data-total')).toBe('52');
    expect(section.getAttribute('data-skip')).toBe('50');
    expect(section.getAttribute('data-base')).toBe('/leader/organizations/org-1');
    expect(section.textContent).toBe('контактов:2 организаций:org-1,org-2');
    expect(listOrganizationNotes).not.toHaveBeenCalled();

    // Без смещения — первая страница.
    listContacts.mockClear();
    await render({ tab: 'contacts' });
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, true, {
      organizationId: 'org-1',
      page: 1,
    });
  });

  it('«История»: тип из адреса уходит в сервис, мусорный и массив — отбрасываются', async () => {
    listOrgHistory.mockResolvedValue({
      ok: true,
      items: [{ id: 'e1' }, { id: 'e2' }],
      total: 7,
      mode: 'exact',
    });
    const typed = await render({ tab: 'history', type: 'note', skip: '20' });

    expect(listOrgHistory).toHaveBeenCalledWith({}, SESSION, {
      orgId: 'org-1',
      type: 'note',
      skip: 20,
    });
    const section = typed.container.querySelector('[data-testid="org-history"]')!;
    expect(section.getAttribute('data-cabinet')).toBe('leader');
    expect(section.getAttribute('data-base')).toBe('/leader/organizations/org-1');
    expect(section.getAttribute('data-total')).toBe('7');
    expect(section.getAttribute('data-skip')).toBe('20');
    expect(section.getAttribute('data-mode')).toBe('exact');
    expect(section.getAttribute('data-active-type')).toBe('note');
    // Флаги выключены — пилюли только для источников без флага.
    expect(section.textContent).toBe('событий:2 типы:audit,note');

    listOrgHistory.mockClear();
    listOrgHistory.mockResolvedValue({ ok: true, items: [], total: 0, mode: 'top' });
    const junk = await render({ tab: 'history', type: 'мусор' });
    // Ключа `type` в аргументах нет вовсе — сервис считает «Все типы».
    expect(listOrgHistory).toHaveBeenCalledWith({}, SESSION, { orgId: 'org-1', skip: 0 });
    const all = junk.container.querySelector('[data-testid="org-history"]')!;
    expect(all.getAttribute('data-active-type')).toBe('null');
    expect(all.getAttribute('data-mode')).toBe('top');

    listOrgHistory.mockClear();
    isFeatureEnabled.mockReturnValue(true);
    const arr = await render({ tab: 'history', type: ['note', 'call'] });
    expect(listOrgHistory).toHaveBeenCalledWith({}, SESSION, { orgId: 'org-1', skip: 0 });
    // Включённые флаги добавляют пилюли диалогов, звонков и писем.
    expect(arr.container.querySelector('[data-testid="org-history"]')!.textContent).toBe(
      'событий:0 типы:audit,note,dialog,call,inbound'
    );
  });

  it('отказ любого сервиса — узел вкладки пустой, страница не падает', async () => {
    isFeatureEnabled.mockReturnValue(true);
    listContacts.mockResolvedValue({ ok: false, error: 'forbidden' });
    listOrganizationNotes.mockResolvedValue({ ok: false, error: 'not_found' });
    listOrgHistory.mockResolvedValue({ ok: false, error: 'not_found' });

    const contacts = await render({ tab: 'contacts' });
    expect(contacts.container.querySelector('[data-testid="org-contacts"]')).toBeNull();
    expect(
      contacts.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('contacts');

    const overview = await render();
    expect(overview.container.querySelector('[data-testid="pinned-notes"]')).toBeNull();

    const notes = await render({ tab: 'notes' });
    expect(notes.container.querySelector('[data-testid="org-notes"]')).toBeNull();
    expect(
      notes.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('notes');

    const history = await render({ tab: 'history' });
    expect(history.container.querySelector('[data-testid="org-history"]')).toBeNull();
    expect(
      history.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('history');
  });
});
