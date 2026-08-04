import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Аудит A1: селекты организаций партнёра уехали со страниц (team /
 * enrollments / certificates) в сервис. Главное, что здесь пиннится, —
 * изоляция портфеля: в `where` ВСЕГДА есть partnerId, а partner-manager
 * дополнительно сужен до закреплённых организаций (§4, ФТ-6.2).
 */

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findMany } } }));

import { prisma } from '@/lib/db/prisma';
import {
  listPartnerOrgOptions,
  listVisiblePartnerOrgOptions,
} from '@/lib/services/partner/orgOptions';

function lastArgs() {
  return findMany.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);
});

describe('listPartnerOrgOptions (весь портфель партнёра)', () => {
  it('фильтр по partnerId, порядок по имени, узкий select', async () => {
    const rows = await listPartnerOrgOptions(prisma, { partnerId: 'pt-1' });

    expect(findMany).toHaveBeenCalledWith({
      where: { partnerId: 'pt-1' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    expect(rows).toEqual([{ id: 'org-1', name: 'ООО Ромашка' }]);
  });
});

describe('listVisiblePartnerOrgOptions (граница видимости пользователя партнёра)', () => {
  it('partner-admin: только partnerId, без сужения', async () => {
    const rows = await listVisiblePartnerOrgOptions(prisma, {
      partnerId: 'pt-1',
      partnerRole: 'admin',
      assignedOrgIds: ['org-9'],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { partnerId: 'pt-1' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    expect(rows).toEqual([{ id: 'org-1', name: 'ООО Ромашка' }]);
  });

  it('partner-manager: сужение до assignedOrgIds поверх partnerId', async () => {
    await listVisiblePartnerOrgOptions(prisma, {
      partnerId: 'pt-1',
      partnerRole: 'manager',
      assignedOrgIds: ['org-9'],
    });

    expect(lastArgs().where).toEqual({ partnerId: 'pt-1', id: { in: ['org-9'] } });
  });

  it('partner-manager без assignedOrgIds → пустое сужение, а не «все»', async () => {
    await listVisiblePartnerOrgOptions(prisma, { partnerId: 'pt-1', partnerRole: 'manager' });

    expect(lastArgs().where).toEqual({ partnerId: 'pt-1', id: { in: [] } });
  });

  it('partnerRole не задан (legacy-сессия) → границей остаётся partnerId', async () => {
    await listVisiblePartnerOrgOptions(prisma, { partnerId: 'pt-1' });

    expect(lastArgs().where).toEqual({ partnerId: 'pt-1' });
  });
});
