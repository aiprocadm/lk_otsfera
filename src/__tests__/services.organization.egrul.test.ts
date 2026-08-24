import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `У-94`: подстановка реквизитов из ЕГРЮЛ. Проверяем не «вызвался ли update», а
 * три вещи, ради которых требование написано: право (роль и её граница),
 * «заполняется только отмеченное» и защита от дубля ИНН внутри компании.
 */
const { canManagerAccessOrg } = vi.hoisted(() => ({ canManagerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ canManagerAccessOrg }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import type { SessionPayload } from '@/lib/auth/jwt';
import { fillFromEgrul } from '@/lib/services/organization/egrul';

const ORG = {
  id: 'org-1',
  companyId: 'co-1',
  inn: null,
  kpp: null,
  legalName: null,
  ogrn: null,
  legalAddress: null,
};

function db(org: unknown = ORG, clash: unknown = null) {
  const update = vi.fn();
  const findUnique = vi.fn().mockResolvedValue(org);
  const findFirst = vi.fn().mockResolvedValue(clash);
  const tx = { organization: { update }, auditLog: {} };
  return {
    prisma: {
      organization: { findUnique, findFirst, update },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
    } as never,
    update,
    findFirst,
  };
}

const session = (role: string): SessionPayload =>
  ({ sub: 'u1', role, companyId: 'co-1' }) as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  canManagerAccessOrg.mockResolvedValue(true);
});

describe('fillFromEgrul (У-94)', () => {
  it('заполняет только отмеченные поля — внесённое вручную не затирается', async () => {
    const { prisma, update } = db();
    const res = await fillFromEgrul(prisma, session('admin'), {
      orgId: 'org-1',
      values: { inn: '7707083893', legalAddress: 'Москва' },
    });

    expect(res).toEqual({ ok: true, filled: ['inn', 'legalAddress'] });
    expect(update.mock.calls[0]![0].data).toEqual({ inn: '7707083893', legalAddress: 'Москва' });
  });

  it('пустое значение — это «не отмечено», а не «стереть»', async () => {
    const { prisma, update } = db();
    const res = await fillFromEgrul(prisma, session('admin'), {
      orgId: 'org-1',
      values: { inn: '7707083893', kpp: '   ' },
    });

    expect(res).toEqual({ ok: true, filled: ['inn'] });
    expect(update.mock.calls[0]![0].data).toEqual({ inn: '7707083893' });
  });

  it('ничего не отмечено — отказ, в базу не пишем', async () => {
    const { prisma, update } = db();
    expect(await fillFromEgrul(prisma, session('admin'), { orgId: 'org-1', values: {} })).toEqual({
      ok: false,
      error: 'nothing_selected',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('ИНН занят другой организацией компании — отказ (иначе платежи привяжутся неоднозначно)', async () => {
    const { prisma, update, findFirst } = db(ORG, { id: 'org-2' });
    expect(
      await fillFromEgrul(prisma, session('admin'), {
        orgId: 'org-1',
        values: { inn: '7707083893' },
      })
    ).toEqual({ ok: false, error: 'inn_taken' });
    expect(update).not.toHaveBeenCalled();
    // Свою же организацию за «дубль» не принимаем.
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({
      companyId: 'co-1',
      id: { not: 'org-1' },
    });
  });

  it('организации нет — not_found', async () => {
    const { prisma } = db(null);
    expect(
      await fillFromEgrul(prisma, session('admin'), { orgId: 'ghost', values: { inn: '1' } })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('менеджер без доступа к организации — forbidden, в базу не ходим', async () => {
    canManagerAccessOrg.mockResolvedValue(false);
    const { prisma, update } = db();
    expect(
      await fillFromEgrul(prisma, session('manager'), { orgId: 'org-1', values: { inn: '1' } })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('менеджер с доступом — можно; руководитель тоже (граница внутри предиката)', async () => {
    for (const role of ['manager', 'leader']) {
      const { prisma } = db();
      const res = await fillFromEgrul(prisma, session(role), {
        orgId: 'org-1',
        values: { inn: '7707083893' },
      });
      expect(res.ok, role).toBe(true);
    }
  });

  it('партнёру и заказчику ЕГРЮЛ-подстановка недоступна: ТЗ называет три роли', async () => {
    for (const role of ['partner', 'organization', 'student']) {
      const { prisma, update } = db();
      expect(
        await fillFromEgrul(prisma, session(role), { orgId: 'org-1', values: { inn: '1' } }),
        role
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(update, role).not.toHaveBeenCalled();
    }
  });

  it('пишет в журнал что было и что стало — правку видно в аудите', async () => {
    const { prisma } = db({ ...ORG, kpp: '770701001' });
    await fillFromEgrul(prisma, session('admin'), {
      orgId: 'org-1',
      values: { inn: '7707083893', kpp: '997750001' },
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'organization_egrul_filled',
        entity: 'organization',
        entityId: 'org-1',
        before: { inn: null, kpp: '770701001' },
        after: { inn: '7707083893', kpp: '997750001' },
      })
    );
  });
});
