import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
// Предикаты охвата — настоящие; мок только чтения флага общей видимости.
vi.mock('@/lib/auth/managerPolicy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/managerPolicy')>()),
  getCompanyTeamVisibility,
}));

import { setOrgRequisitesByStaff } from '@/lib/services/admin/counterpartyRequisites';

/**
 * `У-278` (ТЗ 13.10.2026): реквизиты организации правит и сотрудник из карточки
 * заказа. Охват — как у самой организации (§4, C8): администратор — любая,
 * руководитель — своей компании, менеджер — своей компании и закреплённая
 * (или вся компания при общей видимости). Отказ — до записи.
 */
const INPUT = { legalName: 'ООО «Ромашка»', signerBasis: 'Устава' };

function db(org: { companyId: string } | null) {
  const findUnique = vi.fn().mockResolvedValue(org);
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: { organization: { findUnique, update } } as unknown as PrismaClient,
    update,
  };
}

const ADMIN = { sub: 'a1', role: 'admin' } as SessionPayload;
const LEADER = {
  sub: 'l1',
  role: 'leader',
  companyId: 'co-1',
  managedOrgIds: [],
} as SessionPayload;
const MANAGER = {
  sub: 'm1',
  role: 'manager',
  companyId: 'co-1',
  managedOrgIds: ['org-mine'],
} as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
});

describe('setOrgRequisitesByStaff', () => {
  it('администратор — любая организация; основание полномочий пишется', async () => {
    const { prisma, update } = db({ companyId: 'co-OTHER' });
    expect(await setOrgRequisitesByStaff(prisma, ADMIN, 'org-x', INPUT)).toEqual({ ok: true });
    expect(update.mock.calls[0]![0].data).toMatchObject({ signerBasis: 'Устава' });
  });

  it('руководитель — организация своей компании, без закрепления', async () => {
    const { prisma, update } = db({ companyId: 'co-1' });
    expect(await setOrgRequisitesByStaff(prisma, LEADER, 'org-any', INPUT)).toEqual({ ok: true });
    expect(update).toHaveBeenCalled();
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });

  it('менеджер — закреплённая за ним организация', async () => {
    const { prisma } = db({ companyId: 'co-1' });
    expect(await setOrgRequisitesByStaff(prisma, MANAGER, 'org-mine', INPUT)).toEqual({ ok: true });
  });

  it('менеджер — чужая (не закреплённая) организация своей компании → forbidden без записи', async () => {
    const { prisma, update } = db({ companyId: 'co-1' });
    expect(await setOrgRequisitesByStaff(prisma, MANAGER, 'org-colleague', INPUT)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('менеджер при общей видимости компании — любая организация компании', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const { prisma } = db({ companyId: 'co-1' });
    expect(await setOrgRequisitesByStaff(prisma, MANAGER, 'org-colleague', INPUT)).toEqual({
      ok: true,
    });
  });

  it('организация другой компании → forbidden и руководителю, и менеджеру (C8)', async () => {
    for (const session of [LEADER, MANAGER]) {
      const { prisma, update } = db({ companyId: 'co-OTHER' });
      expect(await setOrgRequisitesByStaff(prisma, session, 'org-mine', INPUT)).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('организации нет → not_found', async () => {
    const { prisma } = db(null);
    expect(await setOrgRequisitesByStaff(prisma, LEADER, 'gone', INPUT)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('клиентские роли и сотрудник без компании → forbidden, база не трогается', async () => {
    const sessions = [
      { sub: 'o1', role: 'organization' } as SessionPayload,
      { sub: 'p1', role: 'partner' } as SessionPayload,
      { ...MANAGER, companyId: null } as SessionPayload,
    ];
    for (const session of sessions) {
      const { prisma, update } = db({ companyId: 'co-1' });
      expect(await setOrgRequisitesByStaff(prisma, session, 'org-mine', INPUT)).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('кривые реквизиты → validation с русским текстом (та же проверка, что у администратора)', async () => {
    const { prisma, update } = db({ companyId: 'co-1' });
    const res = await setOrgRequisitesByStaff(prisma, LEADER, 'org-1', { inn: '123' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(update).not.toHaveBeenCalled();
  });
});
