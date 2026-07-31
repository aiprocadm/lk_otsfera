// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Этап 5 PR-1: страницы заявок клиентов (эталон — pages.enrollment-detail.test.tsx).
 *  - partner/organization: флаг off → notFound; happy → форма + список; деталка
 *    [id]: сервис not_found → notFound, happy → разметка с backHref;
 *  - manager/leader/admin: очередь рендерится; флаг off → notFound;
 *  - ФТ-1.7: /partner/leads при включённых client_requests → redirect('/partner/requests').
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

const auth = vi.hoisted(() => ({
  requirePartner: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => auth);

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const svc = vi.hoisted(() => ({ listClientRequests: vi.fn(), getClientRequest: vi.fn() }));
vi.mock('@/lib/services/clientRequests/list', () => svc);

const { listClientRequestAttachments } = vi.hoisted(() => ({
  listClientRequestAttachments: vi.fn(),
}));
vi.mock('@/lib/services/clientRequests/attachments', () => ({ listClientRequestAttachments }));

const { listLeads } = vi.hoisted(() => ({ listLeads: vi.fn() }));
vi.mock('@/lib/services/partner/leads', () => ({ listLeads }));

// Презентационные компоненты покрыты своими W1-тестами — здесь стабы,
// проверяем только что страница прокинула правильные props.
vi.mock('@/components/client-requests/client-request-form', () => ({
  ClientRequestForm: () => React.createElement('div', { 'data-testid': 'cr-form' }),
}));
vi.mock('@/components/client-requests/client-request-list', () => ({
  ClientRequestList: (props: { rows: Array<{ id: string }>; detailHrefBase: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'cr-list', 'data-base': props.detailHrefBase },
      props.rows.map((r) => r.id).join(',')
    ),
}));
vi.mock('@/components/client-requests/client-request-queue', () => ({
  ClientRequestQueue: (props: { rows: Array<{ id: string }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'cr-queue' },
      props.rows.map((r) => r.id).join(',')
    ),
}));
vi.mock('@/components/client-requests/client-request-detail-view', () => ({
  ClientRequestDetailView: (props: {
    request: { subject: string };
    attachments: Array<{ name: string }>;
    backHref: string;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'cr-detail',
        'data-back': props.backHref,
        'data-attachments': String(props.attachments.length),
      },
      props.request.subject,
      props.attachments.map((a) => a.name).join(',')
    ),
}));
vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));
// Стабы компонентов старой страницы /partner/leads (нужны только для импорта —
// redirect срабатывает до рендера).
vi.mock('@/components/partner/leads-table', () => ({ LeadsTable: () => null }));
vi.mock('@/components/partner/leads-card-list', () => ({ LeadsCardList: () => null }));
vi.mock('@/components/partner/lead-status-tabs', () => ({ LeadStatusTabs: () => null }));
vi.mock('@/components/partner/leads-search', () => ({ LeadsSearch: () => null }));

import PartnerRequestsPage from '@/app/partner/requests/page';
import PartnerRequestDetailPage from '@/app/partner/requests/[id]/page';
import OrganizationRequestsPage from '@/app/organization/requests/page';
import OrganizationRequestDetailPage from '@/app/organization/requests/[id]/page';
import ManagerRequestsPage from '@/app/manager/requests/page';
import LeaderRequestsPage from '@/app/leader/requests/page';
import AdminRequestsPage from '@/app/admin/requests/page';

const PARTNER_SESSION = { sub: 'p1', role: 'partner' as const, partnerId: 'pt-1', email: 'p@x.ru' };
const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};
const ROWS = [
  { id: 'R1', subject: 'Обучение ОТ', companyName: 'ООО Ромашка', status: 'submitted' },
  { id: 'R2', subject: 'Поставка СИЗ', companyName: 'АО Пион', status: 'in_triage' },
];
const REQUEST = {
  id: 'R1',
  subject: 'Обучение ОТ',
  companyName: 'ООО Ромашка',
  status: 'submitted',
};
const ATTACHMENTS_OK = {
  ok: true,
  rows: [
    {
      id: 'A1',
      name: 'скан.pdf',
      size: 3,
      mimeType: 'application/pdf',
      createdAt: new Date('2026-07-24T10:00:00Z'),
      createdByUserId: 'p1',
      createdByUserName: 'Иван',
    },
  ],
};
const props = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  nav.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe('PartnerRequestsPage (/partner/requests)', () => {
  it('флаг off → notFound, requirePartner не вызывается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(PartnerRequestsPage())).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('client_requests');
    expect(auth.requirePartner).not.toHaveBeenCalled();
  });

  it('happy → форма + список со своими заявками, deталка ведёт в /partner/requests', async () => {
    isFeatureEnabled.mockReturnValue(true);
    auth.requirePartner.mockResolvedValue(PARTNER_SESSION);
    svc.listClientRequests.mockResolvedValue({ rows: ROWS, nextCursor: null });

    const { container } = await renderServerComponent(PartnerRequestsPage());

    expect(container.textContent).toContain('Обращения');
    expect(container.querySelector('[data-testid="cr-form"]')).not.toBeNull();
    const list = container.querySelector('[data-testid="cr-list"]');
    expect(list?.getAttribute('data-base')).toBe('/partner/requests');
    expect(list?.textContent).toBe('R1,R2');
    expect(svc.listClientRequests).toHaveBeenCalledWith({}, PARTNER_SESSION, {});
  });
});

describe('OrganizationRequestsPage (/organization/requests)', () => {
  it('флаг off → notFound, контекст организации не запрашивается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(OrganizationRequestsPage())).rejects.toThrow('NOT_FOUND');
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('happy → OrgAppShell + форма + список, база деталки /organization/requests', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    svc.listClientRequests.mockResolvedValue({ rows: ROWS, nextCursor: null });

    const { container } = await renderServerComponent(OrganizationRequestsPage());

    expect(container.querySelector('[data-testid="org-app-shell"]')).not.toBeNull();
    expect(container.textContent).toContain('ООО Ромашка');
    expect(container.querySelector('[data-testid="cr-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cr-list"]')?.getAttribute('data-base')).toBe(
      '/organization/requests'
    );
    expect(svc.listClientRequests).toHaveBeenCalledWith({}, ORG_CTX.session, {});
  });
});

describe('PartnerRequestDetailPage (/partner/requests/[id])', () => {
  it('флаг off → notFound', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(PartnerRequestDetailPage(props('R1')))).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(auth.requirePartner).not.toHaveBeenCalled();
  });

  it('сервис not_found (чужая заявка) → notFound', async () => {
    isFeatureEnabled.mockReturnValue(true);
    auth.requirePartner.mockResolvedValue(PARTNER_SESSION);
    svc.getClientRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(renderServerComponent(PartnerRequestDetailPage(props('чужая')))).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(svc.getClientRequest).toHaveBeenCalledWith({}, PARTNER_SESSION, 'чужая');
    expect(listClientRequestAttachments).not.toHaveBeenCalled();
  });

  it('happy → деталка с темой, вложениями и backHref /partner/requests', async () => {
    isFeatureEnabled.mockReturnValue(true);
    auth.requirePartner.mockResolvedValue(PARTNER_SESSION);
    svc.getClientRequest.mockResolvedValue({ ok: true, request: REQUEST });
    listClientRequestAttachments.mockResolvedValue(ATTACHMENTS_OK);

    const { container } = await renderServerComponent(PartnerRequestDetailPage(props('R1')));

    const detail = container.querySelector('[data-testid="cr-detail"]');
    expect(detail?.getAttribute('data-back')).toBe('/partner/requests');
    expect(detail?.getAttribute('data-attachments')).toBe('1');
    expect(container.textContent).toContain('Обучение ОТ');
    expect(container.textContent).toContain('скан.pdf');
  });
  it('сбой листинга вложений деградирует в пустой список, страница открывается', async () => {
    // Вложения — не главное на странице. Если их сервис отказал, заявка всё
    // равно должна открыться (принцип §3: fan-out деградирует, а не роняет).
    isFeatureEnabled.mockReturnValue(true);
    auth.requirePartner.mockResolvedValue(PARTNER_SESSION);
    svc.getClientRequest.mockResolvedValue({ ok: true, request: REQUEST });
    listClientRequestAttachments.mockResolvedValue({
      ok: false,
      error: 'NOT_FOUND',
      message: 'нет',
    });

    const { container } = await renderServerComponent(PartnerRequestDetailPage(props('R1')));

    const detail = container.querySelector('[data-testid="cr-detail"]');
    expect(detail?.getAttribute('data-attachments')).toBe('0');
    expect(container.textContent).toContain('Обучение ОТ');
  });
});

describe('OrganizationRequestDetailPage (/organization/requests/[id])', () => {
  it('сервис not_found → notFound', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    svc.getClientRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(OrganizationRequestDetailPage(props('R404')))
    ).rejects.toThrow('NOT_FOUND');
    expect(svc.getClientRequest).toHaveBeenCalledWith({}, ORG_CTX.session, 'R404');
  });

  it('флаг выключен → notFound до обращения к контексту организации', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(OrganizationRequestDetailPage(props('R1')))).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('вложения организации приходят в деталку с приведённой датой', async () => {
    // Дата вложения уходит в клиентский компонент строкой: серверный Date туда
    // передать нельзя. Если бы приведение потерялось, страница упала бы на
    // сериализации — и обращение вообще не открылось бы.
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    svc.getClientRequest.mockResolvedValue({ ok: true, request: REQUEST });
    listClientRequestAttachments.mockResolvedValue(ATTACHMENTS_OK);

    const { container } = await renderServerComponent(OrganizationRequestDetailPage(props('R1')));

    const detail = container.querySelector('[data-testid="cr-detail"]');
    expect(detail?.getAttribute('data-attachments')).toBe('1');
    expect(container.textContent).toContain('скан.pdf');
  });

  it('happy → шелл + деталка, backHref /organization/requests; сбой листинга вложений деградирует в []', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    svc.getClientRequest.mockResolvedValue({ ok: true, request: REQUEST });
    listClientRequestAttachments.mockResolvedValue({
      ok: false,
      error: 'NOT_FOUND',
      message: 'нет',
    });

    const { container } = await renderServerComponent(OrganizationRequestDetailPage(props('R1')));

    expect(container.querySelector('[data-testid="org-app-shell"]')).not.toBeNull();
    const detail = container.querySelector('[data-testid="cr-detail"]');
    expect(detail?.getAttribute('data-back')).toBe('/organization/requests');
    expect(detail?.getAttribute('data-attachments')).toBe('0');
  });
});

describe('очередь триажа: manager / leader / admin', () => {
  const cases = [
    {
      name: 'ManagerRequestsPage',
      Page: ManagerRequestsPage,
      guard: auth.requireManager,
      session: { sub: 'm1', role: 'manager' as const, companyId: 'c1' },
    },
    {
      name: 'LeaderRequestsPage',
      Page: LeaderRequestsPage,
      guard: auth.requireManagerLeader,
      session: {
        sub: 'l1',
        role: 'manager' as const,
        managerRole: 'leader' as const,
        companyId: 'c1',
      },
    },
    {
      name: 'AdminRequestsPage',
      Page: AdminRequestsPage,
      guard: auth.requireAdmin,
      session: { sub: 'a1', role: 'admin' as const },
    },
  ];

  for (const { name, Page, guard, session } of cases) {
    it(`${name}: флаг off → notFound, гард не вызывается`, async () => {
      isFeatureEnabled.mockReturnValue(false);
      await expect(renderServerComponent(Page())).rejects.toThrow('NOT_FOUND');
      expect(guard).not.toHaveBeenCalled();
    });

    it(`${name}: happy → очередь с заявками`, async () => {
      isFeatureEnabled.mockReturnValue(true);
      guard.mockResolvedValue(session);
      svc.listClientRequests.mockResolvedValue({ rows: ROWS, nextCursor: null });

      const { container } = await renderServerComponent(Page());

      expect(container.textContent).toContain('Обращения клиентов');
      expect(container.querySelector('[data-testid="cr-queue"]')?.textContent).toBe('R1,R2');
      expect(svc.listClientRequests).toHaveBeenCalledWith({}, session, {});
    });
  }
});
