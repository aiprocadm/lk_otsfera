// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Вкладка «Диалоги» карточки организации у трёх кабинетов сотрудников
 * (`У-210`, `У-216`, этап 3 PR-6).
 *
 * Проверяем ровно то, за что отвечает страница, а не сама вкладка:
 *  · вкладка появляется при включённом флаге `inbound_messaging` и исчезает
 *    при выключенном — иначе раздел «утечёт» на прод раньше приёмки;
 *  · у всех трёх кабинетов она одна и та же (правило зеркала §0.2);
 *  · у администратора ссылки в переписку нет (`dialogHref={null}`) и кнопки
 *    «Написать первым» тоже (`writeFirstHref={null}`): `/manager/*` для него
 *    мёртвая дверь (Model A), ссылка вела бы в «Доступ запрещён»;
 *  · у менеджера и руководителя «Написать первым» ведёт в форму, сужённую до
 *    ЭТОЙ организации (`?newOrg=<id>`), а не в общий список людей.
 */

// ─── Гарды трёх кабинетов ───────────────────────────────────────────────────
const { requireAdmin, requireManagerLeader, requireManagerForOrg } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn(),
  requireManagerForOrg: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin,
  requireManagerLeader,
  requireManagerForOrg,
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/managerPolicy')>()),
  getCompanyTeamVisibility,
}));

// ─── Сервисы, в которые карточка ходит на других вкладках ───────────────────
const { getFieldsForEntity } = vi.hoisted(() => ({ getFieldsForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity }));
const { getAutoCreatedFrom1C } = vi.hoisted(() => ({ getAutoCreatedFrom1C: vi.fn() }));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));
const { listOrganizationProposals } = vi.hoisted(() => ({ listOrganizationProposals: vi.fn() }));
vi.mock('@/lib/services/documents/proposalBlocks', () => ({ listOrganizationProposals }));
const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));
const { listContacts } = vi.hoisted(() => ({ listContacts: vi.fn() }));
vi.mock('@/lib/services/contacts/list', () => ({ listContacts, CONTACT_LIST_PAGE: 50 }));
const { listContactOrgOptions } = vi.hoisted(() => ({ listContactOrgOptions: vi.fn() }));
vi.mock('@/lib/services/contacts/orgOptions', () => ({ listContactOrgOptions }));
const { listOrganizationNotes } = vi.hoisted(() => ({ listOrganizationNotes: vi.fn() }));
vi.mock('@/lib/services/organizationNotes/list', () => ({ listOrganizationNotes }));
const { listColleagues } = vi.hoisted(() => ({ listColleagues: vi.fn() }));
vi.mock('@/lib/services/staffChat/mentions', () => ({ listColleagues }));

// Этап 4 (`У-220`): страница добирает задачи объекта для блока «Задачи».
const { listLinkedTasks } = vi.hoisted(() => ({ listLinkedTasks: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/services/tasks/board', () => ({ listLinkedTasks }));

const { listOrgHistory } = vi.hoisted(() => ({ listOrgHistory: vi.fn() }));
vi.mock('@/lib/services/organization/orgHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/organization/orgHistory')>()),
  listOrgHistory,
}));

// Админские блоки карточки — заглушки: к вкладке «Диалоги» они отношения не
// имеют, но без них страница полезла бы в базу.
const { getOrganization, getOrganizationMeta } = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  getOrganizationMeta: vi.fn(),
}));
vi.mock('@/lib/services/admin/organizations', () => ({ getOrganization, getOrganizationMeta }));
const { listOrgRateHistory } = vi.hoisted(() => ({ listOrgRateHistory: vi.fn() }));
vi.mock('@/lib/services/commission/rateHistory', () => ({ listOrgRateHistory }));
const { getOrgRequisitesByAdmin } = vi.hoisted(() => ({ getOrgRequisitesByAdmin: vi.fn() }));
vi.mock('@/lib/services/admin/counterpartyRequisites', () => ({
  getOrgRequisitesByAdmin,
  getPartnerRequisitesByAdmin: vi.fn(),
}));
vi.mock('@/server-actions/requisites', () => ({
  setOrgRequisitesByAdminAction: vi.fn(),
  setPartnerRequisitesByAdminAction: vi.fn(),
}));
vi.mock('@/components/requisites/requisites-card', () => ({ RequisitesCard: () => null }));
vi.mock('@/components/partner/customer-access-section', () => ({
  CustomerAccessSection: () => null,
}));
vi.mock('@/components/admin/managers-block', () => ({ ManagersBlock: () => null }));
vi.mock('@/components/admin/organization-edit-form', () => ({ OrganizationEditForm: () => null }));
vi.mock('@/components/admin/admin-rate-override-form', () => ({
  AdminRateOverrideForm: () => null,
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => null,
}));
vi.mock('@/components/organization/auto-created-badge', () => ({ AutoCreatedBadge: () => null }));
vi.mock('@/components/organization/org-employees-section', () => ({
  OrgEmployeesSection: () => null,
}));
vi.mock('@/components/organization/org-contacts-section', () => ({
  OrgContactsSection: () => null,
}));
vi.mock('@/components/organization/org-notes-section', () => ({ OrgNotesSection: () => null }));
vi.mock('@/components/organization/org-history-section', () => ({ OrgHistorySection: () => null }));
vi.mock('@/components/organization/pinned-notes-block', () => ({ PinnedNotesBlock: () => null }));
vi.mock('@/components/organization/org-staff-settings', () => ({ OrgStaffSettings: () => null }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

/**
 * Зеркало пропсов вместо настоящих вкладок: страница отвечает за то, ЧТО
 * передать (состав вкладок и два адреса), а сама вкладка проверена в
 * `components.org-dialogs-section`.
 *
 * `data-dialog-href` различает три состояния, и различать их обязательно:
 * `null` — «ссылки нет» (админ), `function` — «ссылка своя», `undefined` —
 * «карточка соберёт сама». Проверка «ссылки нет» через `typeof` их бы
 * склеила, и пропуск пропса выглядел бы как запрет.
 */
vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: {
    activeTab: string;
    tabs: Array<{ key: string; label: string }>;
    dialogHref?: ((id: string) => string) | null;
    writeFirstHref?: string | null;
  }) =>
    React.createElement('div', {
      'data-testid': 'org-card',
      'data-active': props.activeTab,
      'data-tabs': props.tabs.map((t) => t.key).join(','),
      'data-tab-labels': props.tabs.map((t) => t.label).join(','),
      'data-dialog-href': props.dialogHref === null ? 'null' : typeof props.dialogHref,
      'data-write-first': props.writeFirstHref === null ? 'null' : (props.writeFirstHref ?? 'нет'),
    }),
}));

import AdminOrgPage from '@/app/admin/organizations/[id]/page';
import LeaderOrgPage from '@/app/leader/organizations/[id]/page';
import ManagerOrgPage from '@/app/manager/organizations/[id]/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const, companyId: 'co-1' };
const MANAGER = { sub: 'm1', role: 'manager' as const, companyId: 'co-1' };

const CARD = { id: 'org-1', name: 'ООО «Ромашка»' };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  requireManagerLeader.mockResolvedValue(LEADER);
  requireManagerForOrg.mockResolvedValue(MANAGER);
  getOrganizationCard.mockResolvedValue(CARD);
  getCompanyTeamVisibility.mockResolvedValue(false);
  getFieldsForEntity.mockResolvedValue([]);
  getAutoCreatedFrom1C.mockResolvedValue(null);
  listOrganizationProposals.mockResolvedValue({ ok: true, rows: [] });
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 0, canWrite: true });
  listContacts.mockResolvedValue({ ok: true, items: [], total: 0 });
  listContactOrgOptions.mockResolvedValue([]);
  listOrganizationNotes.mockResolvedValue({ ok: true, notes: [], pinned: [] });
  listColleagues.mockResolvedValue({ ok: true, rows: [] });
  listOrgHistory.mockResolvedValue({ ok: true, items: [], total: 0, mode: 'top' });
  // Админские блоки: минимум, на котором страница собирается.
  getOrganization.mockResolvedValue({
    id: 'org-1',
    name: 'ООО «Ромашка»',
    inn: '1234567890',
    kpp: '123456789',
    externalId: null,
    partner: null,
    partnerCommissionRate: null,
    partnerCommissionRateNote: null,
  });
  getOrganizationMeta.mockResolvedValue({
    company: { id: 'co-1', name: 'Компания' },
    _count: { orders: 0, students: 0, organizationUsers: 0 },
  });
  listOrgRateHistory.mockResolvedValue([]);
  getOrgRequisitesByAdmin.mockResolvedValue(null);
});

/** Одна точка входа на три кабинета — чтобы проверки писались зеркально. */
const CABINETS = [
  { name: 'admin', page: AdminOrgPage },
  { name: 'leader', page: LeaderOrgPage },
  { name: 'manager', page: ManagerOrgPage },
] as const;

type PageFn = (args: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<React.ReactNode>;

async function renderPage(page: unknown, sp: Record<string, string> = {}) {
  const { container } = await renderServerComponent(
    (page as PageFn)({
      params: Promise.resolve({ id: 'org-1' }),
      searchParams: Promise.resolve(sp),
    })
  );
  return container.querySelector('[data-testid="org-card"]')!;
}

describe('Вкладка «Диалоги» и флаг inbound_messaging (У-210)', () => {
  for (const { name, page } of CABINETS) {
    it(`${name}: при включённом флаге вкладка есть и называется «Диалоги»`, async () => {
      // Включён ровно один флаг: так тест доказывает, что вкладку даёт именно
      // `inbound_messaging`, а не соседний флаг «заодно».
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'inbound_messaging');
      const card = await renderPage(page);
      expect(card.getAttribute('data-tabs')?.split(',')).toContain('dialogs');
      // Название одно во всех кабинетах — правило зеркала (§0.2).
      expect(card.getAttribute('data-tab-labels')?.split(',')).toContain('Диалоги');
    });

    it(`${name}: при выключенном флаге вкладки нет вовсе`, async () => {
      // Остальные флаги нарочно включены: вкладка обязана пропасть от своего
      // флага, а не от того, что выключено всё сразу.
      isFeatureEnabled.mockImplementation((flag: string) => flag !== 'inbound_messaging');
      const card = await renderPage(page);
      expect(card.getAttribute('data-tabs')?.split(',')).not.toContain('dialogs');
      expect(card.getAttribute('data-tab-labels')?.split(',')).not.toContain('Диалоги');
    });

    it(`${name}: вкладка открывается по адресу ?tab=dialogs при включённом флаге`, async () => {
      isFeatureEnabled.mockImplementation((flag: string) => flag === 'inbound_messaging');
      const card = await renderPage(page, { tab: 'dialogs' });
      expect(card.getAttribute('data-active')).toBe('dialogs');
    });

    it(`${name}: с выключенным флагом ?tab=dialogs откатывается к «Обзору»`, async () => {
      // Прямая ссылка на скрытую вкладку не должна открывать её в обход флага.
      isFeatureEnabled.mockImplementation((flag: string) => flag !== 'inbound_messaging');
      const card = await renderPage(page, { tab: 'dialogs' });
      expect(card.getAttribute('data-active')).toBe('overview');
    });
  }
});

describe('Куда ведёт вкладка «Диалоги» в каждом кабинете (У-216, Model A)', () => {
  it('администратор: ни ссылки на диалог, ни кнопки «Написать первым»', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const card = await renderPage(AdminOrgPage);
    expect(card.getAttribute('data-dialog-href')).toBe('null');
    expect(card.getAttribute('data-write-first')).toBe('null');
  });

  it('руководитель: «Написать первым» ведёт в форму, сужённую до этой организации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const card = await renderPage(LeaderOrgPage);
    expect(card.getAttribute('data-write-first')).toBe('/manager/messengers?newOrg=org-1');
    // Ссылку на диалог кабинет не задаёт — её собирает сама карточка.
    expect(card.getAttribute('data-dialog-href')).toBe('undefined');
  });

  it('менеджер: тот же адрес «Написать первым», что у руководителя (зеркало §0.2)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const card = await renderPage(ManagerOrgPage);
    expect(card.getAttribute('data-write-first')).toBe('/manager/messengers?newOrg=org-1');
    expect(card.getAttribute('data-dialog-href')).toBe('undefined');
  });

  it('идентификатор организации в адресе экранируется', async () => {
    // Идентификаторы приходят из 1С и Битрикс24 и не обязаны быть безопасными
    // для адреса: без экранирования «&» разрезал бы ссылку.
    isFeatureEnabled.mockReturnValue(true);
    const { container } = await renderServerComponent(
      (ManagerOrgPage as unknown as PageFn)({
        params: Promise.resolve({ id: 'a&b=1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(
      container.querySelector('[data-testid="org-card"]')?.getAttribute('data-write-first')
    ).toBe('/manager/messengers?newOrg=a%26b%3D1');
  });
});
