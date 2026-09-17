import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { canSeeOrder, memberOrderScope } from '@/lib/auth/organizationPolicy';
import {
  getOrgMemberScopeSetting,
  orgOrderScope,
  setOrgMemberScope,
} from '@/lib/services/organization/memberScope';

/** `У-236` (`Р-Э6-2`): «участники видят только свои заказы» — политика и настройка. */

function session(role: 'admin' | 'leader' | 'member' | null, sub = 'u1'): SessionPayload {
  return {
    sub,
    role: 'organization',
    organizationMemberships: [{ organizationId: 'o1', roleInOrg: role, isActive: true }],
  } as unknown as SessionPayload;
}

function db(setting: boolean | null = false) {
  const prisma = {
    organization: {
      findUnique: vi.fn(async () =>
        setting === null ? null : { membersSeeOwnOrdersOnly: setting }
      ),
      update: vi.fn(async () => ({})),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

beforeEach(() => vi.clearAllMocks());

describe('memberOrderScope', () => {
  it('настройка выключена — ограничения нет ни у кого', () => {
    expect(memberOrderScope(session('member'), 'o1', false)).toBeNull();
    expect(memberOrderScope(session('admin'), 'o1', false)).toBeNull();
  });

  it('настройка включена: администратор и руководитель видят всё', () => {
    expect(memberOrderScope(session('admin'), 'o1', true)).toBeNull();
    expect(memberOrderScope(session('leader'), 'o1', true)).toBeNull();
  });

  it('участник — два правила: контакт заказа или инициатор обращения', () => {
    const scope = memberOrderScope(session('member'), 'o1', true);
    expect(scope).toEqual({
      viewerUserId: 'u1',
      where: {
        OR: [
          { primaryContact: { userId: 'u1' } },
          { promotedFromLead: { sourceRequest: { submittedByUserId: 'u1' } } },
        ],
      },
    });
  });

  it('членство без роли считается участником — ограничение применяется', () => {
    expect(memberOrderScope(session(null), 'o1', true)).not.toBeNull();
  });
});

describe('canSeeOrder', () => {
  it('без ограничения — по членству; заказ-сирота и чужая организация — нет', () => {
    expect(canSeeOrder(session('member'), { organizationId: 'o1' }, false)).toBe(true);
    expect(canSeeOrder(session('member'), { organizationId: 'other' }, false)).toBe(false);
    expect(canSeeOrder(session('member'), { organizationId: null }, false)).toBe(false);
  });

  it('с ограничением — только «свой» заказ', () => {
    expect(
      canSeeOrder(session('member'), { organizationId: 'o1', ownedByViewer: true }, true)
    ).toBe(true);
    expect(
      canSeeOrder(session('member'), { organizationId: 'o1', ownedByViewer: false }, true)
    ).toBe(false);
    // Признак не передали — считаем чужим: молчаливое «видно» опаснее отказа.
    expect(canSeeOrder(session('member'), { organizationId: 'o1' }, true)).toBe(false);
  });
});

describe('orgOrderScope / getOrgMemberScopeSetting', () => {
  it('читает настройку организации и превращает её в границу', async () => {
    const off = db(false);
    expect(await orgOrderScope(off.prisma, session('member'), 'o1')).toBeNull();
    expect(off.raw.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      select: { membersSeeOwnOrdersOnly: true },
    });
    const on = db(true);
    expect(await orgOrderScope(on.prisma, session('member'), 'o1')).toMatchObject({
      viewerUserId: 'u1',
    });
    expect(await orgOrderScope(on.prisma, session('admin'), 'o1')).toBeNull();
    // Организации нет — сужать нечего, но и падать незачем.
    const none = db(null);
    expect(await orgOrderScope(none.prisma, session('member'), 'o1')).toBeNull();
    expect(await getOrgMemberScopeSetting(none.prisma, 'o1')).toBe(false);
    expect(await getOrgMemberScopeSetting(on.prisma, 'o1')).toBe(true);
  });
});

describe('setOrgMemberScope', () => {
  it('меняет только администратор организации', async () => {
    const { prisma, raw } = db(false);
    expect(await setOrgMemberScope(prisma, session('leader'), 'o1', true)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await setOrgMemberScope(prisma, session('member'), 'o1', true)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(raw.organization.update).not.toHaveBeenCalled();
  });

  it('пишет значение и аудит с before/after; организации нет — not_found', async () => {
    const { prisma, raw } = db(false);
    expect(await setOrgMemberScope(prisma, session('admin'), 'o1', true)).toEqual({ ok: true });
    expect(raw.organization.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { membersSeeOwnOrdersOnly: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'organization_member_scope_changed',
        entity: 'organization',
        entityId: 'o1',
        before: { membersSeeOwnOrdersOnly: false },
        after: { membersSeeOwnOrdersOnly: true },
      })
    );
    const none = db(null);
    expect(await setOrgMemberScope(none.prisma, session('admin'), 'o1', true)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
