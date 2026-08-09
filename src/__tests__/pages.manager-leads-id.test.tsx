// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerLeadDetailPage from '@/app/manager/leads/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getManagerLead } = vi.hoisted(() => ({ getManagerLead: vi.fn() }));
vi.mock('@/lib/services/manager/leads', () => ({ getManagerLead }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// Этап 7 (ФТ-3.2): блок задач лида — сервис и панель стабятся.
const { listLinkedTasks } = vi.hoisted(() => ({ listLinkedTasks: vi.fn() }));
vi.mock('@/lib/services/tasks/board', () => ({ listLinkedTasks }));
vi.mock('@/components/tasks/linked-tasks-panel', () => ({
  LinkedTasksPanel: (props: { link: unknown; tasks: unknown[]; currentUserId: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'linked-tasks-panel' },
      JSON.stringify(props.link),
      JSON.stringify(props.tasks)
    ),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/partner/lead-status-badge', () => ({
  LeadStatusBadge: (props: { status: string }) =>
    React.createElement('span', { 'data-testid': 'status-badge' }, props.status),
}));

vi.mock('@/components/manager/push-lead-button', () => ({
  PushLeadButton: (props: { leadId: string }) =>
    React.createElement('button', { 'data-testid': 'push-lead-button' }, props.leadId),
}));

vi.mock('@/components/manager/manager-lead-actions', () => ({
  ManagerLeadActions: (props: {
    leadId: string;
    status: string;
    hasOrganization: boolean;
    promotedOrderId: unknown;
    candidates: unknown;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'lead-actions' },
      props.leadId,
      props.status,
      String(props.hasOrganization),
      String(props.promotedOrderId),
      JSON.stringify(props.candidates)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'member' as const,
  companyId: 'c1',
};

const BASE_LEAD = {
  id: 'lead-1',
  clientCompanyName: 'ООО Ромашка',
  subject: 'Обучение по ОТ',
  partnerName: 'Партнёр',
  organizationName: null as string | null,
  organizationId: null as string | null,
  clientContactName: 'Иванов',
  clientContactPhone: null as string | null,
  clientContactEmail: null as string | null,
  clientInn: null as string | null,
  estimatedAmount: null as string | null,
  productType: [] as string[],
  assignedManagerName: null as string | null,
  createdByUserName: 'Создатель',
  status: 'new',
  rejectedReason: null as string | null,
  notes: null as string | null,
  promotedOrderId: null as string | null,
  externalIdInOneC: null as string | null,
  pushedToOneCAt: null as Date | null,
};

describe('ManagerLeadDetailPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getManagerLead.mockReset();
    listCompanyManagers.mockReset();
    listCompanyManagers.mockResolvedValue([]);
    listLinkedTasks.mockReset().mockResolvedValue([]);
    vi.unstubAllEnvs();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the lead does not exist', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue(null);

    await expect(
      renderServerComponent(ManagerLeadDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders all "—" fallbacks when optional fields are null/empty, and shows the org-required hint', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue(BASE_LEAD);

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain('ООО Ромашка');
    expect(container.textContent).toContain('— (не привязана)');
    expect(container.textContent).toContain('Чтобы преобразовать заявку в заказ');
    expect(container.textContent).not.toContain('Причина отклонения');
    expect(container.querySelector('[data-testid="lead-actions"]')?.textContent).toContain('false');
    // 1С: лид ещё не отправлялся — строка-заглушка + кнопка отправки смонтирована
    expect(container.textContent).toContain('не отправлялся');
    expect(container.querySelector('[data-testid="push-lead-button"]')?.textContent).toBe('lead-1');
  });

  it.each([
    ['звонка', { sourceCallId: 'c1' }, 'открыть звонки', '/manager/calls'],
    ['обращения', { sourceInboundId: 'i1' }, 'открыть обращения', '/manager/inbox'],
  ])('лид из %s: ссылка ведёт к источнику', async (_label, over, label, href) => {
    // Ссылка «открыть …» — единственный способ вернуться к первоисточнику лида
    // (звонку или письму). Без неё менеджер теряет контекст разговора.
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({ ...BASE_LEAD, sourceRequestId: null, ...over });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain(label);
    expect(container.innerHTML).toContain(href);
  });

  it('лид без партнёра подписывается «— (без партнёра)»', async () => {
    // Лид, заведённый сотрудником вручную, партнёра не имеет. Пустая ячейка
    // выглядела бы как потерянные данные.
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({ ...BASE_LEAD, partnerName: null });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain('— (без партнёра)');
  });

  it('pushedToOneCAt задан: строка «1С» с датой и номером, кнопка отправки скрыта', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({
      ...BASE_LEAD,
      pushedToOneCAt: new Date('2026-06-05T00:00:00Z'),
      externalIdInOneC: 'EXT-77',
    });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain('отправлено 05.06.2026, №EXT-77');
    expect(container.textContent).not.toContain('не отправлялся');
    expect(container.querySelector('[data-testid="push-lead-button"]')).toBeNull();
  });

  it('pushedToOneCAt без externalIdInOneC: номер рендерится прочерком', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({
      ...BASE_LEAD,
      pushedToOneCAt: new Date('2026-06-05T00:00:00Z'),
      externalIdInOneC: null,
    });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain('отправлено 05.06.2026, №—');
    expect(container.querySelector('[data-testid="push-lead-button"]')).toBeNull();
  });

  it('renders populated fields, org present, rejectedReason, and notes', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({
      ...BASE_LEAD,
      organizationName: 'Org',
      organizationId: 'org-1',
      clientContactPhone: '+7 900 000-00-00',
      clientContactEmail: 'a@b.com',
      clientInn: '1234567890',
      estimatedAmount: '1000.00',
      productType: ['training', 'certification'],
      assignedManagerName: 'Менеджер А',
      status: 'rejected',
      rejectedReason: 'Нет бюджета',
      notes: 'Примечание к заявке',
    });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).toContain('Org');
    expect(container.textContent).toContain('+7 900 000-00-00');
    expect(container.textContent).toContain('a@b.com');
    expect(container.textContent).toContain('1234567890');
    expect(container.textContent).toContain('training, certification');
    expect(container.textContent).toContain('Менеджер А');
    expect(container.textContent).toContain('Причина отклонения: Нет бюджета');
    expect(container.textContent).toContain('Примечание к заявке');
    // rejected status -> the org-required hint must not show even without org
    expect(container.querySelector('[data-testid="lead-actions"]')?.textContent).toContain('true');
  });

  it('передаёт в actions только активных менеджеров компании, кроме самого себя, узким {id,name,email}', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue(BASE_LEAD);
    listCompanyManagers.mockResolvedValue([
      {
        id: 'u1',
        name: 'Я сам',
        email: 'me@x.ru',
        isActive: true,
        managerRole: 'member',
        assignments: [],
      },
      {
        id: 'm2',
        name: 'Мария',
        email: 'm@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm3',
        name: 'Неактивный',
        email: 'off@x.ru',
        isActive: false,
        managerRole: null,
        assignments: [],
      },
    ]);

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(listCompanyManagers).toHaveBeenCalledWith(expect.anything(), 'c1');
    const actions = container.querySelector('[data-testid="lead-actions"]')?.textContent ?? '';
    expect(actions).toContain(JSON.stringify([{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]));
    expect(actions).not.toContain('Я сам');
    expect(actions).not.toContain('Неактивный');
  });

  it('companyId=null: кандидаты пустые, listCompanyManagers не вызывается', async () => {
    requireManager.mockResolvedValue({ ...SESSION, companyId: null });
    getManagerLead.mockResolvedValue(BASE_LEAD);

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="lead-actions"]')?.textContent).toContain('[]');
  });

  it('does not show the org-required hint when status is promoted_to_order even without an organization', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({
      ...BASE_LEAD,
      status: 'promoted_to_order',
      promotedOrderId: 'order-9',
    });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.textContent).not.toContain('Чтобы преобразовать заявку в заказ');
    expect(container.querySelector('[data-testid="lead-actions"]')?.textContent).toContain(
      'order-9'
    );
  });

  it('этап 7: при выключенном internal_tasks блок «Задачи» скрыт и сервис не зовётся', async () => {
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({ ...BASE_LEAD });

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(container.querySelector('[data-testid="linked-tasks-panel"]')).toBeNull();
    expect(listLinkedTasks).not.toHaveBeenCalled();
  });

  it('этап 7: при включённом internal_tasks рендерит блок «Задачи» с задачами лида', async () => {
    vi.stubEnv('FEATURE_INTERNAL_TASKS', '1');
    requireManager.mockResolvedValue(SESSION);
    getManagerLead.mockResolvedValue({ ...BASE_LEAD });
    listLinkedTasks.mockResolvedValue([{ id: 't1' }]);

    const { container } = await renderServerComponent(
      ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
    );

    expect(listLinkedTasks).toHaveBeenCalledWith({}, SESSION, { leadId: 'lead-1' });
    const panel = container.querySelector('[data-testid="linked-tasks-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('lead-1');
    expect(panel!.textContent).toContain('t1');
    expect(container.textContent).toContain('Задачи');
  });

  // Этап 11 PR-2 (ФТ-15.6): цепочка обращение → лид.
  describe('хлебные крошки', () => {
    async function renderLead(extra: Record<string, unknown>) {
      requireManager.mockResolvedValue(SESSION);
      getManagerLead.mockResolvedValue({ ...BASE_LEAD, source: 'client_request', ...extra });
      return renderServerComponent(
        ManagerLeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })
      );
    }

    it('лид из обращения ведёт цепочку от обращений', async () => {
      const { container } = await renderLead({ sourceRequestId: 'req-1' });
      const nav = container.querySelector('nav[aria-label="Хлебные крошки"]');
      expect(nav).not.toBeNull();
      expect(nav!.textContent).toContain('Обращения');
      expect(nav!.textContent).toContain('ООО Ромашка');
    });

    it('лид без обращения ведёт цепочку от списка лидов', async () => {
      const { container } = await renderLead({ sourceRequestId: null, source: 'manual' });
      const nav = container.querySelector('nav[aria-label="Хлебные крошки"]');
      expect(nav!.textContent).toContain('Лиды');
      expect(nav!.textContent).not.toContain('Обращения');
    });
  });
});
