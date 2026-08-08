// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartnerAdmin } = vi.hoisted(() => ({ requirePartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartnerAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { canPartnerAccessOrg } = vi.hoisted(() => ({ canPartnerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg }));

const { getOrgCard } = vi.hoisted(() => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard }));

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

    // У-1/Р-4: ни поля ввода ставки, ни кнопки сохранения здесь быть не должно.
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toContain('Сохранить');
    expect(container.textContent).not.toContain('Вернуть базовую ставку');
  });

  it('объясняет себя и даёт действие — §15 «где я / что здесь / что дальше»', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(container.textContent).toContain('Настройки организации');
    expect(container.textContent).toContain('Ставку комиссии назначает учебный центр');
    expect(container.textContent).toContain('Здесь пока нечего менять');

    // Тот же адрес ведёт и вкладка «Комментарии», поэтому ищем среди всех ссылок
    // именно кнопку-действие пустого состояния.
    const links = Array.from(
      container.querySelectorAll('a[href="/partner/portfolio/org-1?tab=comments"]')
    );
    expect(links.some((a) => a.textContent?.includes('Написать менеджеру'))).toBe(true);
  });
});
