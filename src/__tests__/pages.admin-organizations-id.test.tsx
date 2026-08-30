// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
// §11 ТЗ v0.5 (этап 1 PR-3): страница подтягивает настраиваемые поля — мокаем
// сервис, иначе он полезет в реальный prisma. Обычная функция, а не vi.fn:
// в файле есть resetAllMocks, он снёс бы заготовленный ответ.
vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => [],
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// Шапка карточки (компания + счётчики) уехала в сервис (аудит A1) — форма
// запроса пиннится в services.admin.organizations.test.ts.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-54`: карточка спрашивает журнал аудита, была ли организация заведена
// импортом. По умолчанию — нет (обычная организация, плашки быть не должно).
const { getAutoCreatedFrom1C } = vi.hoisted(() => ({
  getAutoCreatedFrom1C: vi.fn(async () => null),
}));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));

const { getOrganization, getOrganizationMeta } = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  getOrganizationMeta: vi.fn(),
}));
vi.mock('@/lib/services/admin/organizations', () => ({ getOrganization, getOrganizationMeta }));

const { listOrgRateHistory } = vi.hoisted(() => ({ listOrgRateHistory: vi.fn() }));
vi.mock('@/lib/services/commission/rateHistory', () => ({ listOrgRateHistory }));

// `У-145`: блок выпуска документа без заказа гейтится флагом генерации —
// управляем им детерминированно, а не полагаемся на умолчание реестра.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// `У-97`: на карточке появился список сотрудников организации — он ходит в
// базу, поэтому сервис подменяем.
const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));
vi.mock('@/components/organization/org-employees-section', () => ({
  OrgEmployeesSection: (p: { total: number }) =>
    React.createElement('div', { 'data-testid': 'org-employees' }, `сотрудников:${p.total}`),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

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
  OrganizationEditForm: (props: { org: unknown }) =>
    React.createElement('div', { 'data-testid': 'org-edit-form' }, JSON.stringify(props.org)),
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

// Этап 8 (PR-1): реквизиты для документов — сервис и карточка стабятся.
const { getOrgRequisitesByAdmin, getPartnerRequisitesByAdmin } = vi.hoisted(() => ({
  getOrgRequisitesByAdmin: vi.fn().mockResolvedValue(null),
  getPartnerRequisitesByAdmin: vi.fn().mockResolvedValue(null),
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

describe('AdminOrganizationDetailPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getOrganizationMeta.mockReset();
    getOrganization.mockReset();
    listOrgRateHistory.mockReset();
    listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });
    listOrgCardEmployees.mockReset();
    listOrgCardEmployees.mockResolvedValue({ rows: [], total: 0, canWrite: true });
    nav.notFound.mockClear();
  });

  it('calls notFound() when org is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(null);
    getOrganizationMeta.mockResolvedValue(META);

    await expect(
      renderServerComponent(
        AdminOrganizationDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('calls notFound() when meta is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        AdminOrganizationDetailPage({
          params: Promise.resolve({ id: 'org-1' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders org details with company name, inn/kpp, external id, and volumes', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(getOrganization).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(container.textContent).toContain('Организация 1');
    expect(container.textContent).toContain('Партнёр 1');
    expect(container.textContent).toContain('Компания');
    expect(container.textContent).toContain('1234567890');
    expect(container.textContent).toContain('123456789');
    expect(container.textContent).toContain('ext-1');
    expect(container.textContent).toContain('5 заказов');
    expect(container.querySelector('[data-testid="rate-override-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="customer-access"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="managers-block"]')).not.toBeNull();
  });

  it('карточка реквизитов появляется, когда реквизиты заведены', async () => {
    // Здесь админ правит реквизиты заказчика для автогенерации документов.
    // Без карточки их негде заполнить — а без них счёт и акт не собираются.
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    getOrgRequisitesByAdmin.mockResolvedValue({
      legalName: 'ООО Заказчик',
      inn: '7707083893',
      kpp: null,
      ogrn: null,
      legalAddress: null,
      bankName: null,
      bankAccount: null,
      corrAccount: null,
      bic: null,
      signerName: null,
      signerPosition: null,
      signerBasis: null,
    });

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    // Название секции — из реестра, подсказка про DaData — от самой карточки.
    expect(
      container.querySelector('[data-testid="org-settings-requisites"]')?.textContent
    ).toContain('Реквизиты');
    expect(container.querySelector('[data-testid="requisites-card"]')?.textContent).toContain(
      'DaData'
    );
  });

  it('falls back partner/company/kpp/externalId/inn to defaults when absent', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue({
      ...ORG,
      partner: null,
      kpp: null,
      externalId: null,
      inn: null,
    });
    getOrganizationMeta.mockResolvedValue({ ...META, company: null });

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('Без партнёра');
    expect(container.textContent).not.toContain('Компания:');
  });

  it('renders the rate history section with rows (percent formatting, changedByName)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
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

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(listOrgRateHistory).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(container.textContent).toContain('История изменений');
    expect(container.textContent).toMatch(/5\s*%/);
    expect(container.textContent).toMatch(/10\s*%/);
    expect(container.textContent).toContain('Admin One');
    expect(container.textContent).not.toContain('ещё не меняли');
  });

  it('renders "—" for oldRate:null and «сброс (ставка партнёра)» for newRate:null', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    listOrgRateHistory.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 'ch-reset',
          oldRate: null,
          newRate: null,
          effectiveFrom: new Date('2026-04-01'),
          changedByName: null,
        },
      ],
    });

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('сброс (ставка партнёра)');
  });

  it('renders the empty state «ставку ещё не меняли» when history has no rows', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('Ставку по этой организации ещё не меняли');
  });

  it('gracefully falls back to the empty state when listOrgRateHistory returns ok:false', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    listOrgRateHistory.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('Ставку по этой организации ещё не меняли');
  });

  /**
   * `У-145`: администратору выпуск без заказа доступен тем же компонентом, что
   * менеджеру и руководителю. Карточка администратора пока плоская (реестр
   * вкладок она не использует — расхождение записано в AUDIT.md), поэтому
   * блок отдельный, а условие то же.
   */
  it('блок «Документы» с кнопкой выпуска есть, когда генерация включена', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(container.textContent).toContain('Создать документ');
    expect(container.innerHTML).toContain('/admin/documents?tab=general');
  });

  it('выключенная генерация документов блок убирает целиком', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getOrganization.mockResolvedValue(ORG);
    getOrganizationMeta.mockResolvedValue(META);
    listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(
      AdminOrganizationDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(container.textContent).not.toContain('Создать документ');
  });
});
