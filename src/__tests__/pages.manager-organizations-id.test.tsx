// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerOrgDetailPage from '@/app/manager/organizations/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerForOrg } = vi.hoisted(() => ({ requireManagerForOrg: vi.fn() }));
// §11 ТЗ v0.5 (этап 1 PR-3): страница подтягивает настраиваемые поля — мокаем
// сервис, иначе он полезет в реальный prisma. Обычная функция, а не vi.fn:
// в файле есть resetAllMocks, он снёс бы заготовленный ответ.
const { getFieldsForEntity } = vi.hoisted(() => ({ getFieldsForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity }));

// `У-99`: содержимое вкладки «Настройки» собирает отдельный серверный
// компонент — здесь проверяем, что страница его подключает и грузит поля
// ТОЛЬКО на этой вкладке.
vi.mock('@/components/organization/org-staff-settings', () => ({
  OrgStaffSettings: (p: { cabinet: string }) =>
    React.createElement('div', null, `НАСТРОЙКИ:${p.cabinet}`),
}));

// `У-97`: список сотрудников грузится сервисом только на своей вкладке.
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

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerForOrg }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-54`: карточка спрашивает журнал аудита, была ли организация заведена
// импортом. По умолчанию — нет (обычная организация, плашки быть не должно).
// `У-166`: блок КП грузит сервис — здесь он подменён, страница ходит в базу
// только через него.
const { listOrganizationProposals } = vi.hoisted(() => ({ listOrganizationProposals: vi.fn() }));
vi.mock('@/lib/services/documents/proposalBlocks', () => ({ listOrganizationProposals }));

const { getAutoCreatedFrom1C } = vi.hoisted(() => ({
  getAutoCreatedFrom1C: vi.fn(async () => null),
}));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

// Табы «Обращения»/«Звонки» гейтятся флагами inbound_messaging/telephony_mango —
// мокаем isFeatureEnabled, чтобы детерминированно управлять видимостью в тестах.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// Этап 1 ТЗ 12.09.2026 (спека §3.7–§3.8): вкладки «Контакты» (`У-182`),
// «Заметки» (`У-183`), «История» (`У-184`) и блок «Важное» ходят в базу только
// через сервисы — здесь они подменены. Охват команды менеджера страница читает
// свежим из настройки компании (C8) и отдаёт контактам как `teamMode`.
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/managerPolicy')>()),
  getCompanyTeamVisibility,
}));
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

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// `У-95`: состав вкладок страница берёт из реестра `lib/navigation/orgCardTabs`,
// чтобы .filter в странице прогонял обе ветки `||` предиката видимости.
vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: {
    card: unknown;
    activeTab: string;
    tabs?: { key: string }[];
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
      { 'data-testid': 'org-card-tabs' },
      `active:${props.activeTab}`,
      ' tabs:',
      (props.tabs ?? []).map((t) => t.key).join(','),
      ' ',
      JSON.stringify(props.card),
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

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};
const CARD = { id: 'org-1', name: 'Org' };

/**
 * Умолчания сервисов этапа 1: доступ есть, данных нет. Ставятся в каждом
 * `beforeEach` после сброса моков, чтобы прежние проверки вкладок не падали на
 * `undefined`, а проверки этапа 1 подменяли ответы точечно.
 */
function primeStageOneMocks() {
  getCompanyTeamVisibility.mockResolvedValue(false);
  listContacts.mockResolvedValue({ ok: true, items: [], total: 0 });
  listContactOrgOptions.mockResolvedValue([]);
  listOrganizationNotes.mockResolvedValue({ ok: true, notes: [], pinned: [] });
  listColleagues.mockResolvedValue({ ok: true, rows: [] });
  listOrgHistory.mockResolvedValue({ ok: true, items: [], total: 0, mode: 'top' });
}

describe('ManagerOrgDetailPage', () => {
  beforeEach(() => {
    requireManagerForOrg.mockReset();
    getOrganizationCard.mockReset();
    nav.notFound.mockClear();
    // По умолчанию оба флага выключены (opt-in) — вкладки «Обращения»/«Звонки» скрыты.
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
    listOrganizationProposals.mockReset();
    listOrganizationProposals.mockResolvedValue({ ok: true, rows: [] });
    primeStageOneMocks();
  });

  it('calls notFound() when getOrganizationCard returns null', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        ManagerOrgDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('defaults to the "overview" tab when no ?tab= is present', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(requireManagerForOrg).toHaveBeenCalledWith('org-1');
    expect(getOrganizationCard).toHaveBeenCalledWith({}, SESSION, 'org-1');
    expect(container.textContent).toContain('active:overview');
  });

  it('uses a recognized ?tab= value verbatim', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'payments' }),
      })
    );

    expect(container.textContent).toContain('active:payments');
  });

  it('falls back to "overview" for an unrecognized ?tab= value', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'bogus' }),
      })
    );

    expect(container.textContent).toContain('active:overview');
  });

  it('falls back to "overview" when ?tab= is a string[] (not typeof string)', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: ['payments', 'orders'] }),
      })
    );

    expect(container.textContent).toContain('active:overview');
  });

  it('shows the «Обращения»/«Звонки» tabs when both feature flags are enabled', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('inbound');
    expect(container.textContent).toContain('calls');
  });

  it('hides the «Обращения»/«Звонки» tabs when both feature flags are disabled', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    // beforeEach already sets both flags off.

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    const tabsLine = container.textContent ?? '';
    expect(tabsLine).not.toContain('inbound');
    expect(tabsLine).not.toContain('calls');
    expect(tabsLine).toContain('active:overview');
  });

  it('honors ?tab=calls only while the telephony flag is on (independent of inbound)', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'telephony_mango');

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'calls' }),
      })
    );

    expect(container.textContent).toContain('active:calls');
    // «Обращения» остаётся скрытой — флаги независимы.
    expect(container.textContent).not.toContain('inbound');
  });

  it('falls back to "overview" when ?tab=calls but the telephony flag is off', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    // beforeEach keeps telephony_mango off → «Звонки» filtered out of visibleTabs.

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'calls' }),
      })
    );

    expect(container.textContent).toContain('active:overview');
  });

  it('этап 7 PR-3: вкладки client_requests/deals гейтятся флагами, leads — всегда', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    // Все флаги выключены → внутренние вкладки: только leads.
    let res = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    let tabs = res.container.textContent ?? '';
    expect(tabs).toContain('leads');
    expect(tabs).not.toContain('requests');
    expect(tabs).not.toContain('deals');

    isFeatureEnabled.mockImplementation(
      (f: string) => f === 'client_requests' || f === 'deals_pipeline'
    );
    res = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'deals' }),
      })
    );
    tabs = res.container.textContent ?? '';
    expect(tabs).toContain('requests');
    expect(tabs).toContain('active:deals');
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): вкладка «Удостоверения» под флагом реестра ───────

describe('ManagerOrgDetailPage — вкладка удостоверений', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isFeatureEnabled.mockReturnValue(false);
    primeStageOneMocks();
  });

  it('видна при certificates_registry=on и её можно выбрать через ?tab=', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    isFeatureEnabled.mockImplementation((f: string) => f === 'certificates_registry');

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'certificates' }),
      })
    );
    expect(container.textContent).toContain('certificates');
    expect(container.textContent).toContain('active:certificates');
  });

  it('скрыта при выключенном флаге — ?tab=certificates падает на «Обзор»', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'certificates' }),
      })
    );
    expect(container.textContent).toContain('active:overview');
  });
});

// ─── `У-99`: вкладка «Настройки» карточки ────────────────────────────────────

describe('ManagerOrgDetailPage — вкладка «Настройки» (У-99)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isFeatureEnabled.mockReturnValue(false);
    getFieldsForEntity.mockResolvedValue([]);
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    primeStageOneMocks();
  });

  it('на вкладке «Настройки» подключает сборщик настроек своего кабинета', async () => {
    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'settings' }),
      })
    );
    expect(container.textContent).toContain('НАСТРОЙКИ:manager');
    expect(getFieldsForEntity).toHaveBeenCalled();
  });

  it('на других вкладках настраиваемые поля не грузятся и под вкладками не висят', async () => {
    // `У-64`: раньше блок дополнительных полей рендерился под переключателем на
    // ЛЮБОЙ вкладке — и запрос к базе шёл всегда.
    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(container.textContent).not.toContain('НАСТРОЙКИ:');
    expect(getFieldsForEntity).not.toHaveBeenCalled();
  });

  /**
   * `У-145`: выпуск документа без заказа — часть карточки организации, но
   * только когда генерация документов включена (`document_generation`,
   * opt-out после `У-144`). «Ничего не включается на сервере»: выключенный
   * флаг убирает и кнопку.
   */
  it('«Создать документ» приходит во вкладку «Документы», когда генерация включена', async () => {
    isFeatureEnabled.mockImplementation((flag: string) => flag === 'document_generation');
    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).toContain('Создать документ');
  });

  it('выключенная генерация документов кнопку не даёт', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).not.toContain('Создать документ');
  });

  /**
   * `У-166`: блок КП на карточке организации — тот же, что на карточке сделки
   * (правило зеркала §0.2 ТЗ). Ссылка ведёт в раздел документов СВОЕГО
   * кабинета.
   */
  it('блок КП рисуется во вкладке «Документы»', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
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
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(container.textContent).toContain('Коммерческие предложения');
    expect(container.querySelector('a[href="/manager/documents/kp-1"]')).toBeTruthy();
    expect(listOrganizationProposals).toHaveBeenCalledWith({}, SESSION, {
      organizationId: 'org-1',
    });
  });

  it('на других вкладках за предложениями не ходим', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(listOrganizationProposals).not.toHaveBeenCalled();
  });
});

// ─── `У-97`: вкладка «Сотрудники» карточки ───────────────────────────────────

describe('ManagerOrgDetailPage — вкладка «Сотрудники» (У-97)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    isFeatureEnabled.mockReturnValue(false);
    listOrgCardEmployees.mockResolvedValue({ rows: [], total: 3, canWrite: true });
    primeStageOneMocks();
  });

  it('список грузится только на своей вкладке, с поиском и смещением из адреса', async () => {
    await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(listOrgCardEmployees).not.toHaveBeenCalled();

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
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
    expect(section.getAttribute('data-base')).toBe('/manager/organizations/org-1');
    expect(section.getAttribute('data-skip')).toBe('25');
    expect(section.textContent).toBe('сотрудников:3');
  });

  it('мусорное смещение — с начала, пустой поиск не передаётся', async () => {
    await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'employees', skip: 'abc', q: '' }),
      })
    );
    expect(listOrgCardEmployees).toHaveBeenCalledWith({}, SESSION, { orgId: 'org-1', skip: 0 });
  });
});

// ─── Этап 1 ТЗ 12.09.2026: «Контакты», «Заметки», «История», «Важное» ─────────

/**
 * Спека §3.7–§3.8: каждая новая вкладка грузит СВОЙ сервис и только когда
 * открыта (`У-97`); «Важное» — закреплённые заметки на «Обзоре»; отказ любого
 * сервиса не валит страницу — узел вкладки просто пустой.
 */
describe('ManagerOrgDetailPage — этап 1 ТЗ 12.09.2026 (У-182…У-184)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    isFeatureEnabled.mockReturnValue(false);
    listOrganizationProposals.mockResolvedValue({ ok: true, rows: [] });
    primeStageOneMocks();
  });

  const render = (sp: Record<string, string | string[]> = {}) =>
    renderServerComponent(
      ManagerOrgDetailPage({
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
    expect(block.getAttribute('data-href')).toBe('/manager/organizations/org-1?tab=notes');
    // Сама вкладка «Заметки» на «Обзоре» не рисуется, коллеги не нужны.
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

    expect(listOrganizationNotes).toHaveBeenCalledWith({}, SESSION, 'org-1');
    expect(listColleagues).toHaveBeenCalledWith({}, SESSION);
    const section = container.querySelector('[data-testid="org-notes"]')!;
    expect(section.getAttribute('data-org')).toBe('org-1');
    expect(section.textContent).toBe('закреплено:n1 заметки:n2,n3 коллеги:u1,u2');
    // «Важное» — только на «Обзоре»: на вкладке заметок это был бы дубль.
    expect(container.querySelector('[data-testid="pinned-notes"]')).toBeNull();
  });

  it('«Контакты»: охват команды — из настройки компании, страница списка — из смещения', async () => {
    // Вкладка живёт под флагом справочника контактов (`У-178`).
    isFeatureEnabled.mockImplementation((f: string) => f === 'contacts');
    getCompanyTeamVisibility.mockResolvedValue(true);
    listContacts.mockResolvedValue({ ok: true, items: [{ id: 'k1' }, { id: 'k2' }], total: 52 });
    listContactOrgOptions.mockResolvedValue([
      { id: 'org-1', name: 'Org' },
      { id: 'org-2', name: 'Другая' },
    ]);
    const { container } = await render({ tab: 'contacts', skip: '50' });

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    // skip=50 при странице в 50 контактов — это вторая страница.
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, true, {
      organizationId: 'org-1',
      page: 2,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, true);
    const section = container.querySelector('[data-testid="org-contacts"]')!;
    expect(section.getAttribute('data-cabinet')).toBe('manager');
    expect(section.getAttribute('data-org')).toBe('org-1');
    expect(section.getAttribute('data-total')).toBe('52');
    expect(section.getAttribute('data-skip')).toBe('50');
    expect(section.getAttribute('data-base')).toBe('/manager/organizations/org-1');
    expect(section.textContent).toBe('контактов:2 организаций:org-1,org-2');
    // Заметки этой вкладке не нужны — лишний запрос не идёт.
    expect(listOrganizationNotes).not.toHaveBeenCalled();
  });

  it('«Контакты»: выключенная командная видимость даёт teamMode=false и первую страницу', async () => {
    isFeatureEnabled.mockImplementation((f: string) => f === 'contacts');
    getCompanyTeamVisibility.mockResolvedValue(false);
    await render({ tab: 'contacts' });

    expect(listContacts).toHaveBeenCalledWith({}, SESSION, false, {
      organizationId: 'org-1',
      page: 1,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, false);
  });

  it('«История»: тип из адреса уходит в сервис, мусорный — отбрасывается', async () => {
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
    expect(section.getAttribute('data-cabinet')).toBe('manager');
    expect(section.getAttribute('data-base')).toBe('/manager/organizations/org-1');
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
  });

  it('«История»: массив в ?type= — не тип; включённые флаги добавляют пилюли', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const { container } = await render({ tab: 'history', type: ['note', 'call'] });

    expect(listOrgHistory).toHaveBeenCalledWith({}, SESSION, { orgId: 'org-1', skip: 0 });
    const section = container.querySelector('[data-testid="org-history"]')!;
    expect(section.getAttribute('data-active-type')).toBe('null');
    expect(section.textContent).toBe('событий:0 типы:audit,note,dialog,call,inbound');
  });

  it('отказ любого сервиса — узел вкладки пустой, страница не падает', async () => {
    isFeatureEnabled.mockImplementation((f: string) => f === 'contacts');
    listContacts.mockResolvedValue({ ok: false, error: 'forbidden' });
    listOrganizationNotes.mockResolvedValue({ ok: false, error: 'not_found' });
    listOrgHistory.mockResolvedValue({ ok: false, error: 'not_found' });

    const contacts = await render({ tab: 'contacts' });
    expect(contacts.container.querySelector('[data-testid="org-contacts"]')).toBeNull();
    expect(contacts.container.textContent).toContain('active:contacts');

    const overview = await render();
    expect(overview.container.querySelector('[data-testid="pinned-notes"]')).toBeNull();
    expect(overview.container.textContent).toContain('active:overview');

    const notes = await render({ tab: 'notes' });
    expect(notes.container.querySelector('[data-testid="org-notes"]')).toBeNull();
    expect(notes.container.textContent).toContain('active:notes');

    const history = await render({ tab: 'history' });
    expect(history.container.querySelector('[data-testid="org-history"]')).toBeNull();
    expect(history.container.textContent).toContain('active:history');
  });
});
