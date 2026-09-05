// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// `У-95`/`У-96` (этап 9, PR-1): карточка администратора — тот же сервис, что у
// менеджера и руководителя; в базу страница ходит только через сервисы.
const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getFieldsForEntity } = vi.hoisted(() => ({ getFieldsForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity }));

// `У-54`: карточка спрашивает журнал аудита, была ли организация заведена
// импортом. По умолчанию — нет (обычная организация, плашки быть не должно).
const { getAutoCreatedFrom1C } = vi.hoisted(() => ({ getAutoCreatedFrom1C: vi.fn() }));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));

const { getOrganization, getOrganizationMeta } = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  getOrganizationMeta: vi.fn(),
}));
vi.mock('@/lib/services/admin/organizations', () => ({ getOrganization, getOrganizationMeta }));

const { listOrgRateHistory } = vi.hoisted(() => ({ listOrgRateHistory: vi.fn() }));
vi.mock('@/lib/services/commission/rateHistory', () => ({ listOrgRateHistory }));

// `У-166`: блок КП грузит сервис — здесь он подменён.
const { listOrganizationProposals } = vi.hoisted(() => ({ listOrganizationProposals: vi.fn() }));
vi.mock('@/lib/services/documents/proposalBlocks', () => ({ listOrganizationProposals }));

// `У-145`: кнопка выпуска документа без заказа гейтится флагом генерации —
// управляем им детерминированно, а не полагаемся на умолчание реестра.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => false) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// `У-97`: список сотрудников ходит в базу — сервис подменяем.
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

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// Общий компонент вкладок подменён «зеркалом» пропсов: страница отвечает за
// состав вкладок, слоты и адреса, а сам компонент проверен своими тестами.
vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: {
    activeTab: string;
    tabs: Array<{ key: string }>;
    headerExtra?: React.ReactNode;
    leadHref?: ((id: string) => string) | null;
    employees?: React.ReactNode;
    settings?: React.ReactNode;
    documentsAction?: React.ReactNode;
    proposals?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'org-card',
        'data-active': props.activeTab,
        'data-tabs': props.tabs.map((t) => t.key).join(','),
        'data-lead-href': props.leadHref === null ? 'null' : typeof props.leadHref,
      },
      props.headerExtra,
      props.employees,
      props.settings,
      props.documentsAction,
      props.proposals
    ),
}));

vi.mock('@/components/partner/customer-access-section', () => ({
  CustomerAccessSection: (props: { organizationId: string; canInvite: boolean; source: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'customer-access' },
      props.organizationId,
      String(props.canInvite),
      props.source
    ),
}));

vi.mock('@/components/admin/managers-block', () => ({
  ManagersBlock: (props: { orgId: string }) =>
    React.createElement('div', { 'data-testid': 'managers-block' }, props.orgId),
}));

vi.mock('@/components/admin/organization-edit-form', () => ({
  OrganizationEditForm: (props: { org: { id: string } }) =>
    React.createElement('div', { 'data-testid': 'org-edit-form' }, props.org.id),
}));

vi.mock('@/components/admin/admin-rate-override-form', () => ({
  AdminRateOverrideForm: (props: {
    organizationId: string;
    initialRate: unknown;
    initialNote: unknown;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'rate-override-form' },
      props.organizationId,
      String(props.initialRate),
      String(props.initialNote)
    ),
}));

vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: (p: { entityId: string }) =>
    React.createElement('div', { 'data-testid': 'custom-fields' }, p.entityId),
}));

vi.mock('@/components/organization/auto-created-badge', () => ({
  AutoCreatedBadge: () => React.createElement('div', { 'data-testid': 'auto-created' }),
}));

// Этап 8 (PR-1): реквизиты для документов — сервис и карточка стабятся.
const { getOrgRequisitesByAdmin, getPartnerRequisitesByAdmin } = vi.hoisted(() => ({
  getOrgRequisitesByAdmin: vi.fn(),
  getPartnerRequisitesByAdmin: vi.fn(),
}));
vi.mock('@/lib/services/admin/counterpartyRequisites', () => ({
  getOrgRequisitesByAdmin,
  getPartnerRequisitesByAdmin,
}));
vi.mock('@/server-actions/requisites', () => ({
  setOrgRequisitesByAdminAction: vi.fn(),
  setPartnerRequisitesByAdminAction: vi.fn(),
}));
vi.mock('@/components/requisites/requisites-card', () => ({
  // `У-99`: заголовок секции даёт реестр `orgSettingsSections`, поэтому
  // карточка реквизитов внутри вкладки «Настройки» рисуется без своего.
  RequisitesCard: (props: { description?: string }) =>
    React.createElement('div', { 'data-testid': 'requisites-card' }, props.description),
}));

import AdminOrganizationDetailPage from '@/app/admin/organizations/[id]/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

const CARD = { id: 'org-1', name: 'Организация 1' };

const ORG = {
  id: 'org-1',
  name: 'Организация 1',
  inn: '1234567890',
  kpp: '123456789',
  externalId: 'ext-1',
  partner: { name: 'Партнёр 1' },
  partnerCommissionRate: 0.1,
  partnerCommissionRateNote: 'note',
};

const META = {
  company: { id: 'c1', name: 'Компания' },
  _count: { orders: 5, students: 10, organizationUsers: 2 },
};

function render(sp: Record<string, string> = {}, id = 'org-1') {
  return renderServerComponent(
    AdminOrganizationDetailPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(sp),
    })
  );
}

const card = (c: HTMLElement) => c.querySelector('[data-testid="org-card"]')!;

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(SESSION);
  getOrganizationCard.mockResolvedValue(CARD);
  getOrganization.mockResolvedValue(ORG);
  getOrganizationMeta.mockResolvedValue(META);
  getAutoCreatedFrom1C.mockResolvedValue(null);
  getFieldsForEntity.mockResolvedValue([]);
  getOrgRequisitesByAdmin.mockResolvedValue(null);
  listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 0, canWrite: true });
  listOrganizationProposals.mockResolvedValue({ ok: true, rows: [] });
  isFeatureEnabled.mockReturnValue(false);
});

/**
 * `У-95`/`У-96` (этап 9, PR-1): карточка организации у администратора —
 * по общему реестру вкладок и через общий сервис, как у руководителя и
 * менеджера. До этого экран был плоским набором секций мимо реестра, а
 * сервис карточки администратора не знал (`⚠` AUDIT от 30.08.2026).
 */
describe('AdminOrganizationDetailPage — карточка по реестру (У-95, У-96)', () => {
  it('гард администратора и карточка из общего сервиса под его сессией', async () => {
    const { container } = await render();

    expect(requireAdmin).toHaveBeenCalled();
    expect(getOrganizationCard).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(card(container).getAttribute('data-active')).toBe('overview');
  });

  it('состав вкладок — фильтр реестра для кабинета admin: свои есть, флаговых без флага нет', async () => {
    const { container } = await render();
    const keys = card(container).getAttribute('data-tabs')!.split(',');
    expect(keys[0]).toBe('overview');
    for (const own of ['orders', 'documents', 'employees', 'settings']) {
      expect(keys).toContain(own);
    }
    for (const gated of ['threads', 'calls', 'requests', 'deals', 'certificates']) {
      expect(keys).not.toContain(gated);
    }
  });

  it('крошки ведут в СВОЙ список организаций', async () => {
    const { container } = await render();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/organizations');
    expect(hrefs.some((h) => h?.startsWith('/manager/'))).toBe(false);
  });

  it('несуществующая организация — 404', async () => {
    getOrganizationCard.mockResolvedValue(null);
    await expect(render({}, 'missing')).rejects.toThrow('NOT_FOUND');
    expect(nav.notFound).toHaveBeenCalled();
  });

  it('вкладка из адреса подхватывается, мусор откатывается к «Обзору»', async () => {
    const ok = await render({ tab: 'documents' });
    expect(card(ok.container).getAttribute('data-active')).toBe('documents');

    const junk = await render({ tab: 'нет-такой' });
    expect(card(junk.container).getAttribute('data-active')).toBe('overview');
  });

  it('в шапке — компания организации (админ видит все учебные центры), без компании строки нет', async () => {
    const withCompany = await render();
    expect(withCompany.container.textContent).toContain('Компания: Компания');

    getOrganizationMeta.mockResolvedValue({ ...META, company: null });
    const without = await render();
    expect(without.container.textContent).not.toContain('Компания:');
  });

  it('раздела «Лиды» у администратора нет — тема лида без ссылки в /manager (Model A)', async () => {
    const { container } = await render();
    expect(card(container).getAttribute('data-lead-href')).toBe('null');
  });

  it('плашка «создано импортом» спрашивается у журнала аудита', async () => {
    const { container } = await render();
    expect(getAutoCreatedFrom1C).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(container.querySelector('[data-testid="auto-created"]')).not.toBeNull();
  });
});

describe('AdminOrganizationDetailPage — вкладка «Сотрудники» (У-97)', () => {
  it('список грузится только на своей вкладке, с поиском и смещением из адреса', async () => {
    await render();
    expect(listOrgCardEmployees).not.toHaveBeenCalled();

    const { container } = await render({ tab: 'employees', q: 'Иван', skip: '25' });
    expect(listOrgCardEmployees).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orgId: 'org-1',
      q: 'Иван',
      skip: 25,
    });
    const section = container.querySelector('[data-testid="org-employees"]')!;
    expect(section.getAttribute('data-base')).toBe('/admin/organizations/org-1');
    expect(section.getAttribute('data-skip')).toBe('25');
  });

  it('мусорное смещение — с начала, пустой поиск не передаётся', async () => {
    await render({ tab: 'employees', skip: 'abc', q: '' });
    expect(listOrgCardEmployees).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orgId: 'org-1',
      skip: 0,
    });
  });
});

describe('AdminOrganizationDetailPage — вкладка «Документы» (У-145, У-166)', () => {
  it('«Создать документ» приходит во вкладку при включённой генерации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const { container } = await render({ tab: 'documents' });
    expect(container.textContent).toContain('Создать документ');
  });

  it('выключенная генерация кнопку не даёт', async () => {
    const { container } = await render({ tab: 'documents' });
    expect(container.textContent).not.toContain('Создать документ');
  });

  it('блок КП рисуется и ведёт в СВОЙ раздел документов', async () => {
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
    const { container } = await render({ tab: 'documents' });
    expect(container.textContent).toContain('Коммерческие предложения');
    expect(container.querySelector('a[href="/admin/documents/kp-1"]')).toBeTruthy();
    expect(listOrganizationProposals).toHaveBeenCalledWith({}, SESSION, {
      organizationId: 'org-1',
    });
  });

  it('на других вкладках за предложениями не ходим, а отказ сервиса блок не рисует', async () => {
    await render();
    expect(listOrganizationProposals).not.toHaveBeenCalled();

    listOrganizationProposals.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await render({ tab: 'documents' });
    expect(container.textContent).not.toContain('Коммерческие предложения');
  });
});

describe('AdminOrganizationDetailPage — вкладка «Настройки» (У-99)', () => {
  it('на «Обзоре» данные настроек не грузятся (У-64: под вкладками ничего лишнего)', async () => {
    const { container } = await render();
    expect(getOrganization).not.toHaveBeenCalled();
    expect(getOrgRequisitesByAdmin).not.toHaveBeenCalled();
    expect(listOrgRateHistory).not.toHaveBeenCalled();
    expect(getFieldsForEntity).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="rate-override-form"]')).toBeNull();
  });

  it('прежние блоки администратора — во вкладке: форма, доступ, менеджеры, ставка, поля', async () => {
    const { container } = await render({ tab: 'settings' });

    expect(getOrganization).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(getOrgRequisitesByAdmin).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(listOrgRateHistory).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(getFieldsForEntity).toHaveBeenCalledWith(
      expect.anything(),
      SESSION,
      'organization',
      'org-1'
    );

    expect(container.querySelector('[data-testid="org-edit-form"]')?.textContent).toBe('org-1');
    expect(container.querySelector('[data-testid="customer-access"]')?.textContent).toBe(
      'org-1trueadmin'
    );
    expect(container.querySelector('[data-testid="managers-block"]')?.textContent).toBe('org-1');
    expect(container.querySelector('[data-testid="rate-override-form"]')?.textContent).toBe(
      'org-10.1note'
    );
    expect(container.querySelector('[data-testid="custom-fields"]')?.textContent).toBe('org-1');
  });

  it('карточка реквизитов появляется, когда реквизиты заведены', async () => {
    // Здесь админ правит реквизиты заказчика для автогенерации документов.
    // Без карточки их негде заполнить — а без них счёт и акт не собираются.
    getOrgRequisitesByAdmin.mockResolvedValue({ legalName: 'ООО Заказчик', inn: '7707083893' });
    const { container } = await render({ tab: 'settings' });

    // Название секции — из реестра, подсказка про DaData — от самой карточки.
    expect(
      container.querySelector('[data-testid="org-settings-requisites"]')?.textContent
    ).toContain('Реквизиты');
    expect(container.querySelector('[data-testid="requisites-card"]')?.textContent).toContain(
      'DaData'
    );
  });

  it('без реквизитов карточки нет', async () => {
    const { container } = await render({ tab: 'settings' });
    expect(container.querySelector('[data-testid="requisites-card"]')).toBeNull();
  });

  it('история ставки: строки с процентами и автором', async () => {
    listOrgRateHistory.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'ch-1',
          oldRate: 0.05,
          newRate: 0.1,
          effectiveFrom: new Date('2026-03-01'),
          changedByName: 'Admin One',
        },
      ],
    });
    const { container } = await render({ tab: 'settings' });
    expect(container.textContent).toContain('История изменений');
    expect(container.textContent).toMatch(/5\s*%/);
    expect(container.textContent).toMatch(/10\s*%/);
    expect(container.textContent).toContain('Admin One');
    expect(container.textContent).not.toContain('ещё не меняли');
  });

  it('пустая история и отказ сервиса — одно и то же «ставку ещё не меняли»', async () => {
    const empty = await render({ tab: 'settings' });
    expect(empty.container.textContent).toContain('Ставку по этой организации ещё не меняли');

    listOrgRateHistory.mockResolvedValue({ ok: false, error: 'forbidden' });
    const denied = await render({ tab: 'settings' });
    expect(denied.container.textContent).toContain('Ставку по этой организации ещё не меняли');
  });

  it('организация пропала между запросами — 404, а не пустая форма', async () => {
    getOrganization.mockResolvedValue(null);
    await expect(render({ tab: 'settings' })).rejects.toThrow('NOT_FOUND');
  });
});
