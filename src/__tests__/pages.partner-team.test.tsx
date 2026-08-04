// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartnerAdmin } = vi.hoisted(() => ({ requirePartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartnerAdmin }));

// Селект организаций уехал в сервис; форма запроса и граница портфеля
// пиннятся в services.partner.orgOptions.test.ts (аудит A1).
const { listPartnerOrgOptions } = vi.hoisted(() => ({ listPartnerOrgOptions: vi.fn() }));
vi.mock('@/lib/services/partner/orgOptions', () => ({ listPartnerOrgOptions }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listTeam } = vi.hoisted(() => ({ listTeam: vi.fn() }));
vi.mock('@/lib/services/partner/team', () => ({ listTeam }));

// InviteMemberForm ('use client') -> useFetchSubmit -> useFormAction -> useRouter().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PartnerTeamPage from '@/app/partner/team/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

const ACTIVE_ROW = {
  userId: 'u1',
  partnerUserId: 'pu1',
  email: 'admin@example.com',
  name: 'Админ Админов',
  roleInPartner: 'admin' as const,
  assignedOrgIds: [],
  isActive: true,
  createdAt: new Date('2024-01-01'),
};

const INACTIVE_ROW = {
  ...ACTIVE_ROW,
  userId: 'u2',
  partnerUserId: 'pu2',
  email: 'inactive@example.com',
  name: 'Неактивный',
  isActive: false,
};

describe('PartnerTeamPage', () => {
  beforeEach(() => {
    requirePartnerAdmin.mockReset();
    listPartnerOrgOptions.mockReset();
    listTeam.mockReset();
  });

  it('shows the singular "деактивирован" suffix when exactly one member is inactive', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    listTeam.mockResolvedValue([ACTIVE_ROW, INACTIVE_ROW]);
    listPartnerOrgOptions.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);

    const { container } = await renderServerComponent(PartnerTeamPage());

    expect(listTeam).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(listPartnerOrgOptions).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1' });
    expect(container.textContent).toContain('Команда');
    expect(container.textContent).toContain('1 активный сотрудник');
    // Singular: no trailing 'о' suffix.
    expect(container.textContent).toContain('1 деактивирован');
    expect(container.textContent).not.toContain('1 деактивировано');
  });

  it('shows the plural "деактивированы" phrasing when more than one member is inactive, with zero active members', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    listTeam.mockResolvedValue([
      { ...INACTIVE_ROW, userId: 'u2' },
      { ...INACTIVE_ROW, userId: 'u3' },
    ]);
    listPartnerOrgOptions.mockResolvedValue([]);

    const { container } = await renderServerComponent(PartnerTeamPage());

    expect(container.textContent).toContain('0 активных сотрудников');
    expect(container.textContent).toContain('2 деактивировано');
  });

  it('omits the deactivated-count clause entirely when all members are active', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    listTeam.mockResolvedValue([ACTIVE_ROW]);
    listPartnerOrgOptions.mockResolvedValue([]);

    const { container } = await renderServerComponent(PartnerTeamPage());

    expect(container.textContent).toContain('1 активный сотрудник');
    expect(container.textContent).not.toContain('деактивирован');
  });
});
