/**
 * Этап 6, PR-6 (`У-145`) — кто может выпустить документ БЕЗ заказа.
 *
 * Модуль отдельный, потому что дверей две (выпуск и подгрузка формы), и
 * разъехавшись, они дали бы форму там, где сервер выпуск запретит.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { getCompanyTeamVisibility, canSeeOrganization } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrganization: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrganization }));

import { resolveOrgIssueScope } from '@/lib/services/documents/issueScope';

const session = (over: Record<string, unknown> = {}): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A', ...over }) as unknown as SessionPayload;

function prismaWith(org: unknown) {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(org) },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(true);
  canSeeOrganization.mockReturnValue(true);
});

describe('resolveOrgIssueScope', () => {
  it('клиентские роли не проходят гард роли и до базы не доходят', async () => {
    const prisma = prismaWith({ companyId: 'co-A' });
    for (const role of ['partner', 'organization', 'student']) {
      expect(await resolveOrgIssueScope(prisma, session({ role }), 'org-1')).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('нет организации → not_found; нет компании-исполнителя → org_no_company', async () => {
    expect(await resolveOrgIssueScope(prismaWith(null), session(), 'org-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await resolveOrgIssueScope(prismaWith({ companyId: null }), session(), 'org-1')).toEqual(
      {
        ok: false,
        error: 'org_no_company',
      }
    );
  });

  it('чужая компания → not_found, даже если организация закреплена за менеджером', async () => {
    expect(
      await resolveOrgIssueScope(prismaWith({ companyId: 'co-B' }), session(), 'org-1')
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('в режиме общей видимости хватает своей компании; без него нужно закрепление', async () => {
    const prisma = prismaWith({ companyId: 'co-A' });
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: true,
      companyId: 'co-A',
    });

    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrganization.mockReturnValue(false);
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: false,
      error: 'not_found',
    });

    canSeeOrganization.mockReturnValue(true);
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: true,
      companyId: 'co-A',
    });
  });

  it('администратору компания сессии не нужна — он вне контура менеджеров', async () => {
    const prisma = prismaWith({ companyId: 'co-B' });
    expect(
      await resolveOrgIssueScope(prisma, session({ role: 'admin', companyId: null }), 'org-1')
    ).toEqual({ ok: true, companyId: 'co-B' });
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });
});
