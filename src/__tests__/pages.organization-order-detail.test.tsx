// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationOrderDetailPage from '@/app/organization/orders/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { canSeeOrder } = vi.hoisted(() => ({ canSeeOrder: vi.fn() }));
vi.mock('@/lib/auth/organizationPolicy', () => ({ canSeeOrder }));

const { getOrgOrder, listOrgOrderComments } = vi.hoisted(() => ({
  getOrgOrder: vi.fn(),
  listOrgOrderComments: vi.fn(),
}));
vi.mock('@/lib/services/organization/orders', () => ({ getOrgOrder, listOrgOrderComments }));

const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));

// Лента комментариев уехала в сервис (аудит A1); форма запроса пиннится
// интеграционно в services.organization.orders.test.ts. Ключ `comment` в мок-
// prisma оставлен: страница прокидывает тот же клиент в getValuesForEntity.
vi.mock('@/lib/db/prisma', () => ({ prisma: { comment: {} } }));

// Этап 5 ТЗ 28.10.2026 (`У-353`): шкала этапов — статусы справочника, только чтение.
const { getOrderStatusSteps } = vi.hoisted(() => ({
  getOrderStatusSteps: vi.fn(async () => ({
    steps: [{ id: 's1', label: 'Принято в работу', state: 'current' }],
    terminalLabel: null,
    offPipelineLabel: null,
  })),
}));
vi.mock('@/lib/services/orderStatuses', () => ({ getOrderStatusSteps }));
// Настройка «участники видят только свои заказы» (`У-236`) читается из базы;
// здесь prisma — пустышка, а сама граница проверяется своим стражем.
vi.mock('@/lib/services/organization/memberScope', () => ({
  orgOrderScope: vi.fn(async () => null),
  getOrgMemberScopeSetting: vi.fn(async () => false),
}));

const nav = vi.hoisted(() => ({
  // `У-232`: карточка больше не зовёт notFound() — удалённый или чужой
  // заказ уводит в список раздела с `?missing=1`.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// order-items-section and order-custom-fields are 'use client' components that
// call useRouter() -- stub next/navigation above covers that (no router methods
// are invoked during initial render, only on user interaction).

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

const BASE_ORDER = {
  id: 'order-1',
  organizationId: 'org-1',
  orderNumber: '2024-001',
  title: 'Обучение по ОТ',
  stage: 'in_progress' as const,
  executionStatus: 'in_progress' as const,
  financialStatus: 'not_billed' as const,
  totalAmount: '1000.00',
  paidAmount: '0.00',
  debt: '1000.00',
  vatIncluded: false,
  vatRate: null,
  productMix: [],
  createdAt: new Date('2024-01-01'),
  deadline: null,
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  paidAt: null,
  lastSyncedAt: null,
  managerName: 'Менеджер М.',
  documents: [],
  payments: [],
  commentsCount: 0,
  items: [],
};

describe('OrganizationOrderDetailPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    canSeeOrder.mockReset();
    getOrgOrder.mockReset();
    getValuesForEntity.mockReset();
    listOrgOrderComments.mockReset();
    nav.redirect.mockClear();
  });

  // `У-232` (спека §3.7): удалённый заказ — не 404, а список раздела с плашкой
  // «объект недоступен».
  it('удалённый заказ → редирект в список с ?missing=1, а не 404', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        OrganizationOrderDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('REDIRECT:/organization/orders?missing=1');

    expect(canSeeOrder).not.toHaveBeenCalled();
  });

  it('редирект сохраняет ?org= активной организации: человек остаётся в ней', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        OrganizationOrderDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({ org: 'org-1' }),
        })
      )
    ).rejects.toThrow('REDIRECT:/organization/orders?org=org-1&missing=1');
  });

  // Чужой заказ отвечает ТЕМ ЖЕ редиректом, что и удалённый (§4): по разнице
  // ответов нельзя узнать, что заказ существует.
  it('canSeeOrder отказал (defense-in-depth) → тот же редирект, что и для удалённого', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(BASE_ORDER);
    canSeeOrder.mockReturnValue(false);
    getOrderStatusSteps.mockClear();

    await expect(
      renderServerComponent(
        OrganizationOrderDetailPage({
          params: Promise.resolve({ id: 'order-1' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('REDIRECT:/organization/orders?missing=1');

    expect(canSeeOrder).toHaveBeenCalledWith(
      CTX.session,
      // Третий аргумент — есть ли граница участника (`У-236`); здесь её нет.
      expect.objectContaining({ organizationId: 'org-1' }),
      false
    );
    // `У-353`: статус чужого заказа не читается — шаги идут ПОСЛЕ проверок доступа.
    expect(getOrderStatusSteps).not.toHaveBeenCalled();
  });

  it('renders the full order detail with comments, custom fields, крошки с org-scoped ссылкой раздела, and a document count badge', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue({
      ...BASE_ORDER,
      documents: [
        {
          id: 'd1',
          name: 'Договор.pdf',
          type: 'contract' as const,
          direction: 'incoming' as const,
          signedAt: null,
          createdAt: new Date('2024-01-02'),
          size: 1024,
        },
      ],
    });
    canSeeOrder.mockReturnValue(true);
    listOrgOrderComments.mockResolvedValue([
      {
        id: 'c1',
        body: 'Комментарий',
        createdAt: new Date('2024-01-01'),
        authorName: 'Менеджер М.',
      },
    ]);
    getValuesForEntity.mockResolvedValue({
      ok: true,
      fields: [
        {
          definition: {
            id: 'f1',
            key: 'k1',
            label: 'Поле',
            fieldType: 'text',
            options: null,
            required: false,
            sortOrder: 0,
          },
          value: 'значение',
        },
      ],
    });

    const { container } = await renderServerComponent(
      OrganizationOrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
        searchParams: Promise.resolve({ org: 'org-1' }),
      })
    );

    expect(listOrgOrderComments).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(getValuesForEntity).toHaveBeenCalledWith(
      expect.objectContaining({ comment: expect.anything() }),
      expect.anything(), // сессия: этап 1 ТЗ v0.5 фильтрует поля по ролям на сервере
      'order',
      'order-1'
    );
    // `У-72`: вместо одиночной ссылки «назад» — путь «Заказы → Заказ №…»,
    // причём ссылка раздела несёт ?org= активной организации.
    expect(container.textContent).toContain('Заказы');
    expect(container.querySelector('nav a[href^="/organization/orders"]')).not.toBeNull();
    expect(container.textContent).toContain('Комментарий');
    expect(container.textContent).toContain('Документы');
    expect(container.textContent).toContain('(1)');

    const backLink = container.querySelector('a[href*="/organization/orders"]');
    expect(backLink?.getAttribute('href')).toBe('/organization/orders?org=org-1');
  });

  it('falls back to an empty custom-fields list when getValuesForEntity returns ok:false, and uses the plain back link without an org param', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue(BASE_ORDER);
    canSeeOrder.mockReturnValue(true);
    listOrgOrderComments.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: false, error: 'not_found' });

    const { container } = await renderServerComponent(
      OrganizationOrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    const backLink = container.querySelector('a[href*="/organization/orders"]');
    expect(backLink?.getAttribute('href')).toBe('/organization/orders');
  });

  it('у заказа без номера крошка говорит просто «Заказ», а не «Заказ №null» (У-72)', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgOrder.mockResolvedValue({ ...BASE_ORDER, orderNumber: null });
    canSeeOrder.mockReturnValue(true);
    listOrgOrderComments.mockResolvedValue([]);
    getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });

    const { container } = await renderServerComponent(
      OrganizationOrderDetailPage({
        params: Promise.resolve({ id: 'o1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(container.textContent).toContain('Заказ');
    expect(container.textContent).not.toContain('№null');
  });
});
