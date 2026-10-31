// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderLeadsPage from '@/app/leader/leads/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Лиды» руководителя (этап 4 ТЗ 28.10.2026, `У-349`): зеркало «Лидов»
 * менеджера — список и вид «Воронка» в одном разделе. Проверяется то, что
 * ломается тихо: охват из профиля доступа (сессия доезжает до списка и
 * доски), ссылки фильтров и формы ведут в кабинет руководителя, настройка
 * стадий не потерялась при переезде воронки, флаг воронки выключает только вид.
 */

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listManagerLeads } = vi.hoisted(() => ({ listManagerLeads: vi.fn() }));
vi.mock('@/lib/services/manager/leads', () => ({ listManagerLeads }));

const { listCompanyOrgOptions } = vi.hoisted(() => ({ listCompanyOrgOptions: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listCompanyOrgOptions }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getFunnelBoard } = vi.hoisted(() => ({ getFunnelBoard: vi.fn() }));
vi.mock('@/lib/services/funnel/board', () => ({ getFunnelBoard }));

// Заглушка компонента: рисует div и кладёт полученные пропсы в атрибут.
// В `vi.hoisted` — фабрики `vi.mock` поднимаются выше обычного кода файла.
const { probe } = vi.hoisted(() => ({
  probe:
    (testId: string) =>
    (props: Record<string, unknown>): React.ReactElement =>
      React.createElement('div', {
        'data-testid': testId,
        'data-props': JSON.stringify(props),
      }),
}));

vi.mock('@/components/manager/lead-create-staff-form', () => ({
  LeadCreateStaffForm: probe('lead-create-form'),
}));
vi.mock('@/components/manager/manager-leads-filter', () => ({
  ManagerLeadsFilter: probe('leads-filter'),
}));
vi.mock('@/components/manager/manager-leads-table', () => ({
  ManagerLeadsTable: probe('leads-table'),
}));
vi.mock('@/components/funnel/funnel-board', () => ({ FunnelBoard: probe('funnel-board') }));
vi.mock('@/components/funnel/stage-config', () => ({ StageConfig: probe('stage-config') }));

const SESSION = { sub: 'u-leader', role: 'leader' as const, companyId: 'c1' };

const propsOf = (c: HTMLElement, testId: string): Record<string, unknown> | null => {
  const el = c.querySelector(`[data-testid="${testId}"]`);
  return el ? (JSON.parse(el.getAttribute('data-props') ?? '{}') as Record<string, unknown>) : null;
};

const render = async (sp: Record<string, string> = {}) =>
  (await renderServerComponent(LeaderLeadsPage({ searchParams: Promise.resolve(sp) }))).container;

describe('LeaderLeadsPage (`У-349`)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManagerLeader.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(true);
    listManagerLeads.mockResolvedValue({ rows: [{ id: 'l1' }], nextCursor: 'c2' });
    listCompanyOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Альфа' }]);
    getFunnelBoard.mockResolvedValue({
      stages: [{ id: 'default:new', name: 'Новый' }],
      columns: [],
      shown: 0,
      total: 0,
    });
  });

  it('список: гард руководителя, охват по сессии, фильтры и форма — в кабинете руководителя', async () => {
    const c = await render({ status: 'new', q: 'ООО', assignedToMe: '1' });

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(listManagerLeads).toHaveBeenCalledWith(prismaMock, {
      session: SESSION,
      status: 'new',
      search: 'ООО',
      assignedToUserId: 'u-leader',
      cursor: undefined,
    });
    expect(getFunnelBoard).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Лид — возможная продажа');
    expect(propsOf(c, 'leads-filter')).toMatchObject({ basePath: '/leader/leads' });
    expect(propsOf(c, 'leads-table')).toMatchObject({
      basePath: '/leader/leads',
      rows: [{ id: 'l1' }],
      nextCursor: 'c2',
    });
    expect(propsOf(c, 'lead-create-form')).toMatchObject({
      orgCardHrefBase: '/leader/organizations',
      organizations: [{ id: 'o1', name: 'Альфа' }],
    });
    expect(c.querySelector('[data-testid="stage-config"]')).toBeNull();
  });

  it('переключатель «Список / Воронка» ведёт внутри «Лидов» руководителя', async () => {
    const c = await render();
    const nav = c.querySelector('nav[aria-label="Вид лидов"]')!;
    const links = Array.from(nav.querySelectorAll('a')).map((a) => [
      a.textContent,
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);
    expect(links).toEqual([
      ['Список', '/leader/leads', 'page'],
      ['Воронка', '/leader/leads?view=funnel', null],
    ]);
  });

  it('вид «Воронка»: доска по сессии и настройка стадий под ней (переехала с /leader/funnel)', async () => {
    const c = await render({ view: 'funnel' });

    expect(getFunnelBoard).toHaveBeenCalledWith(prismaMock, SESSION);
    expect(listManagerLeads).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="funnel-board"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="leads-table"]')).toBeNull();
    expect(propsOf(c, 'stage-config')).toEqual({
      stages: [{ id: 'default:new', name: 'Новый' }],
      isDefault: true,
    });
  });

  it('свои стадии — isDefault: false; пустой словарь не роняет страницу', async () => {
    getFunnelBoard.mockResolvedValueOnce({
      stages: [{ id: 'custom-1', name: 'Своя' }],
      columns: [],
      shown: 0,
      total: 0,
    });
    expect(propsOf(await render({ view: 'funnel' }), 'stage-config')).toMatchObject({
      isDefault: false,
    });
    getFunnelBoard.mockResolvedValueOnce({ stages: [], columns: [], shown: 0, total: 0 });
    expect(propsOf(await render({ view: 'funnel' }), 'stage-config')).toEqual({
      stages: [],
      isDefault: false,
    });
  });

  it('доска урезана — честная подпись «Показаны первые N из M»', async () => {
    getFunnelBoard.mockResolvedValueOnce({ stages: [], columns: [], shown: 500, total: 1200 });
    const c = await render({ view: 'funnel' });
    expect(c.textContent).toContain('Показаны первые 500 из 1200.');
    expect(c.textContent).toContain('Живые лиды идут первыми и не теряются');
  });

  it('флаг воронки выключен: «Лиды» есть, переключателя нет, ?view=funnel даёт список', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const c = await render({ view: 'funnel' });

    expect(isFeatureEnabled).toHaveBeenCalledWith('sales_funnel');
    expect(c.querySelector('nav[aria-label="Вид лидов"]')).toBeNull();
    expect(getFunnelBoard).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="leads-table"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="stage-config"]')).toBeNull();
  });
});
