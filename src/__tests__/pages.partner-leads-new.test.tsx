// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { organizationFindMany } = vi.hoisted(() => ({ organizationFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findMany: organizationFindMany } }
}));

// LeadCreateForm ('use client') calls useRouter() via useFetchSubmit/router.back().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() })
}));

import PartnerLeadNewPage from '@/app/partner/leads/new/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

describe('PartnerLeadNewPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    organizationFindMany.mockReset();
  });

  it('scopes organizations to assignedOrgIds when present', async () => {
    requirePartner.mockResolvedValue(SESSION);
    organizationFindMany.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);

    const { container } = await renderServerComponent(PartnerLeadNewPage());

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'p1', id: { in: ['org-1'] } } })
    );
    expect(container.textContent).toContain('Новая заявка');
  });

  it('falls back to the plain partnerId filter when assignedOrgIds is empty', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    organizationFindMany.mockResolvedValue([]);

    await renderServerComponent(PartnerLeadNewPage());

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'p1' } })
    );
  });
});
