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

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerForOrg }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-54`: карточка спрашивает журнал аудита, была ли организация заведена
// импортом. По умолчанию — нет (обычная организация, плашки быть не должно).
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
      props.settings
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};
const CARD = { id: 'org-1', name: 'Org' };

describe('ManagerOrgDetailPage', () => {
  beforeEach(() => {
    requireManagerForOrg.mockReset();
    getOrganizationCard.mockReset();
    nav.notFound.mockClear();
    // По умолчанию оба флага выключены (opt-in) — вкладки «Обращения»/«Звонки» скрыты.
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
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

  it('defaults to the "history" tab when no ?tab= is present', async () => {
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
    expect(container.textContent).toContain('active:history');
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

  it('falls back to "history" for an unrecognized ?tab= value', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'bogus' }),
      })
    );

    expect(container.textContent).toContain('active:history');
  });

  it('falls back to "history" when ?tab= is a string[] (not typeof string)', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: ['payments', 'orders'] }),
      })
    );

    expect(container.textContent).toContain('active:history');
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
    expect(tabsLine).toContain('active:history');
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

  it('falls back to "history" when ?tab=calls but the telephony flag is off', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);
    // beforeEach keeps telephony_mango off → «Звонки» filtered out of visibleTabs.

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'calls' }),
      })
    );

    expect(container.textContent).toContain('active:history');
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

  it('скрыта при выключенном флаге — ?tab=certificates падает на «Историю»', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'certificates' }),
      })
    );
    expect(container.textContent).toContain('active:history');
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
});
