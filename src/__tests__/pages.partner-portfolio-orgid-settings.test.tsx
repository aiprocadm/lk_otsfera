// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartnerAdmin } = vi.hoisted(() => ({ requirePartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartnerAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { canPartnerAccessOrg } = vi.hoisted(() => ({ canPartnerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg }));

const { getOrgCard } = vi.hoisted(() => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard }));

// Этап 4: на вкладке появились реквизиты организации (У-62) и блок доступа
// (У-61). Сервис и оба компонента стабятся — у них своё покрытие.
const { getOrgRequisites } = vi.hoisted(() => ({ getOrgRequisites: vi.fn() }));
vi.mock('@/lib/services/organization/requisites', () => ({ getOrgRequisites }));
vi.mock('@/server-actions/requisites', () => ({ setOrgRequisitesAction: vi.fn() }));
vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: (props: { title: string; canEdit?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'requisites-card' },
      `${props.title} canEdit:${String(props.canEdit)}`
    ),
}));
vi.mock('@/components/partner/customer-access-section', () => ({
  CustomerAccessSection: ({
    organizationId,
    canInvite,
  }: {
    organizationId: string;
    canInvite: boolean;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'customer-access' },
      `access:${organizationId}:${String(canInvite)}`
    ),
}));

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

import OrgSettingsPage from '@/app/partner/portfolio/[orgId]/settings/page';

const SESSION = {
  sub: 'u1',
  role: 'partner' as const,
  partnerId: 'p1',
  partnerRole: 'admin' as const,
};

const BASE_CARD = {
  id: 'org-1',
  name: 'ООО Ромашка',
  inn: '123456',
  kpp: null,
  legalName: null,
  assignedManagerUserId: null,
  partnerCommissionRate: '0.1000',
  partnerCommissionRateNote: 'Индивидуальная ставка',
  kpi: { ordersCount: 3, debt: '1000.00' },
};

describe('OrgSettingsPage', () => {
  beforeEach(() => {
    requirePartnerAdmin.mockReset();
    canPartnerAccessOrg.mockReset();
    getOrgCard.mockReset();
    getOrgRequisites.mockReset().mockResolvedValue({ ok: false, error: 'forbidden' });
    nav.notFound.mockClear();
    nav.redirect.mockClear();
  });

  it('redirects to /forbidden when canPartnerAccessOrg denies access', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(false);

    await expect(
      renderServerComponent(OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) }))
    ).rejects.toThrow('REDIRECT:/forbidden');

    expect(getOrgCard).not.toHaveBeenCalled();
  });

  it('calls notFound() when getOrgCard returns null', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(null);

    await expect(
      renderServerComponent(OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders the org card header without any rate-editing form (У-1)', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(canPartnerAccessOrg).toHaveBeenCalledWith(SESSION, 'org-1');
    expect(getOrgCard).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', partnerId: 'p1' });
    expect(container.textContent).toContain('ООО Ромашка');

    // У-1/Р-4: формы смены ставки здесь нет и быть не должно.
    expect(container.textContent).not.toContain('Вернуть базовую ставку');
    expect(container.textContent).not.toContain('Ставка комиссии партнёра для этой организации');
  });

  it('§15: экран объясняет себя подзаголовком', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(container.textContent).toContain('Ставку комиссии назначает учебный центр');
    // `У-99`: названия секций — из общего реестра, одни на все кабинеты.
    expect(container.textContent).toContain('Реквизиты');
    expect(container.textContent).toContain('Доступ в кабинет');
  });

  // ── этап 4 ───────────────────────────────────────────────────────────────
  it('У-62: реквизиты организации показываются, когда сервис их отдал', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    getOrgRequisites.mockResolvedValue({ ok: true, requisites: { name: 'ООО Ромашка' } });

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(getOrgRequisites).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(container.textContent).toContain('canEdit:true');
  });

  it('У-62: сервис отказал — карточки реквизитов нет (право решает сервер)', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    getOrgRequisites.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(container.querySelector('[data-testid="requisites-card"]')).toBeNull();
  });

  it('У-61: блок «Доступ к организации» живёт здесь, а не под всеми вкладками', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    getOrgRequisites.mockResolvedValue({ ok: true, requisites: { name: 'ООО Ромашка' } });

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(container.textContent).toContain('access:org-1:true');
  });
});
