/**
 * Unit tests for src/lib/services/team/resend.ts (этап 4, ФТ-10.2).
 *
 * resendInvite — общий сервис повторной отправки приглашения:
 *   - скоупы по ролям (admin / organization admin-leader / partner-admin /
 *     manager-leader) + негативные кейсы;
 *   - гейты not_found / already_active / rate_limited;
 *   - гашение старых invite-токенов + выпуск нового в транзакции;
 *   - письмо по роли приглашённого (best-effort, сбой проглатывается);
 *   - sendEmail:false → ссылка без письма;
 *   - аудит invite_resent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { isRateLimited } = vi.hoisted(() => ({ isRateLimited: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { createInviteToken } = vi.hoisted(() => ({ createInviteToken: vi.fn() }));
const sendMocks = vi.hoisted(() => ({
  sendPartnerInviteEmail: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  sendManagerInviteEmail: vi.fn(),
  sendAdminUserInviteEmail: vi.fn()
}));
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));

vi.mock('@/lib/rateLimit', () => ({ isRateLimited }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken }));
vi.mock('@/lib/email/send', () => sendMocks);
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { resendInvite } from '@/lib/services/team/resend';

// ─── helpers ──────────────────────────────────────────────────────────────────

type Target = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  passwordHash: string | null;
  partnerId: string | null;
  companyId: string | null;
};

function makeTarget(over: Partial<Target> = {}): Target {
  return {
    id: 'u-t',
    email: 'target@x.local',
    name: 'Target',
    role: 'partner',
    isActive: true,
    passwordHash: null,
    partnerId: 'p1',
    companyId: null,
    ...over
  };
}

function makePrisma(target: Target | null, over: Record<string, unknown> = {}) {
  const tokenUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { passwordResetToken: { updateMany: tokenUpdateMany } };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
    partner: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationManager: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    ...over
  };
  return { prisma: prisma as never, tx, tokenUpdateMany };
}

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin', name: 'Админ' };
const ORG_ADMIN: SessionPayload = {
  sub: 'org-adm',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }]
};
const PARTNER_ADMIN: SessionPayload = {
  sub: 'pa-1',
  role: 'partner',
  partnerRole: 'admin',
  partnerId: 'p1'
};
const MANAGER_LEADER: SessionPayload = {
  sub: 'ml-1',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'c1'
};

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimited.mockResolvedValue(false);
  createInviteToken.mockResolvedValue({ token: 'tok-resend', expiresAt: new Date() });
  sendMocks.sendPartnerInviteEmail.mockResolvedValue({ status: 'sent', id: 'm1' });
  sendMocks.sendOrgInviteEmail.mockResolvedValue({ status: 'sent', id: 'm2' });
  sendMocks.sendManagerInviteEmail.mockResolvedValue({ status: 'sent', id: 'm3' });
  sendMocks.sendAdminUserInviteEmail.mockResolvedValue({ status: 'sent', id: 'm4' });
});

// ─── гейты not_found / already_active ─────────────────────────────────────────

describe('resendInvite — гейты', () => {
  it('not_found когда пользователя нет', async () => {
    const { prisma } = makePrisma(null);
    expect(await resendInvite(prisma, ADMIN, { userId: 'ghost' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('not_found когда пользователь деактивирован', async () => {
    const { prisma } = makePrisma(makeTarget({ isActive: false }));
    expect(await resendInvite(prisma, ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'not_found'
    });
  });

  it('already_active когда пароль уже установлен', async () => {
    const { prisma } = makePrisma(makeTarget({ passwordHash: 'bcrypt-hash' }));
    expect(await resendInvite(prisma, ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'already_active'
    });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('rate_limited: 5/час на актёра, до выпуска токена', async () => {
    isRateLimited.mockResolvedValue(true);
    const { prisma, tokenUpdateMany } = makePrisma(makeTarget());
    expect(await resendInvite(prisma, ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'rate_limited'
    });
    expect(isRateLimited).toHaveBeenCalledWith('invite-resend:adm-1', {
      windowMs: 60 * 60 * 1000,
      max: 5
    });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(createInviteToken).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ─── скоупы ролей ─────────────────────────────────────────────────────────────

describe('resendInvite — скоуп admin', () => {
  it('admin может переотправить любому пользователю без пароля', async () => {
    const { prisma, tx, tokenUpdateMany } = makePrisma(
      makeTarget({ role: 'manager', partnerId: null, companyId: 'c9' })
    );
    const res = await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(res).toEqual({
      ok: true,
      inviteUrl: expect.stringContaining('/reset-password?token=tok-resend'),
      emailStatus: 'sent'
    });
    // ФТ-10.2: старые невыгоревшие invite-токены гасятся до выпуска нового.
    expect(tokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u-t', purpose: 'invite', usedAt: null },
      data: { usedAt: expect.any(Date) }
    });
    expect(createInviteToken).toHaveBeenCalledWith(tx, 'u-t');
  });
});

describe('resendInvite — скоуп organization admin/leader', () => {
  it('admin организации может переотправить активному участнику своей org', async () => {
    const membership = { id: 'ou-1', organization: { name: 'Org A' } };
    const { prisma } = makePrisma(makeTarget({ role: 'organization', partnerId: null }), {
      organizationUser: { findFirst: vi.fn().mockResolvedValue(membership) }
    });
    const res = await resendInvite(prisma, ORG_ADMIN, { userId: 'u-t' });
    expect(res).toMatchObject({ ok: true, emailStatus: 'sent' });
    // Скоуп-проверка идёт по org, где у актёра admin/leader-membership.
    expect(
      (prisma as { organizationUser: { findFirst: ReturnType<typeof vi.fn> } }).organizationUser
        .findFirst
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u-t',
          isActive: true,
          organizationId: { in: ['org-1'] }
        })
      })
    );
  });

  it('leader организации тоже в скоупе', async () => {
    const session: SessionPayload = {
      sub: 'org-lead',
      role: 'organization',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
    };
    const { prisma } = makePrisma(makeTarget({ role: 'organization', partnerId: null }), {
      organizationUser: { findFirst: vi.fn().mockResolvedValue({ id: 'ou-2', organization: { name: 'O' } }) }
    });
    expect((await resendInvite(prisma, session, { userId: 'u-t' })).ok).toBe(true);
  });

  it('forbidden: у актёра нет admin/leader-membership (только member)', async () => {
    const session: SessionPayload = {
      sub: 'org-member',
      role: 'organization',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'member', isActive: true }]
    };
    const { prisma } = makePrisma(makeTarget({ role: 'organization', partnerId: null }));
    expect(await resendInvite(prisma, session, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: цель не состоит в организациях актёра', async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'organization', partnerId: null }), {
      organizationUser: { findFirst: vi.fn().mockResolvedValue(null) }
    });
    expect(await resendInvite(prisma, ORG_ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: цель не organization-роли', async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'manager', partnerId: null, companyId: 'c1' }));
    expect(await resendInvite(prisma, ORG_ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

describe('resendInvite — скоуп partner-admin', () => {
  it('partner-admin может переотправить активному участнику своей команды', async () => {
    const { prisma } = makePrisma(makeTarget(), {
      partnerUser: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true, roleInPartner: 'manager' })
      },
      partner: { findUnique: vi.fn().mockResolvedValue({ name: 'ООО Партнёр' }) }
    });
    const res = await resendInvite(prisma, PARTNER_ADMIN, { userId: 'u-t' });
    expect(res).toMatchObject({ ok: true, emailStatus: 'sent' });
  });

  it('forbidden: partner-manager (не admin) не может переотправлять', async () => {
    const session: SessionPayload = {
      sub: 'pm-1',
      role: 'partner',
      partnerRole: 'manager',
      partnerId: 'p1'
    };
    const { prisma } = makePrisma(makeTarget());
    expect(await resendInvite(prisma, session, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: цель из чужого партнёра', async () => {
    const { prisma } = makePrisma(makeTarget({ partnerId: 'p2' }));
    expect(await resendInvite(prisma, PARTNER_ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: membership в команде деактивирован', async () => {
    const { prisma } = makePrisma(makeTarget(), {
      partnerUser: { findUnique: vi.fn().mockResolvedValue({ isActive: false }) }
    });
    expect(await resendInvite(prisma, PARTNER_ADMIN, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

describe('resendInvite — скоуп manager-leader', () => {
  it('leader может переотправить менеджеру своей компании', async () => {
    const { prisma } = makePrisma(
      makeTarget({ role: 'manager', partnerId: null, companyId: 'c1' }),
      {
        organizationManager: {
          findFirst: vi.fn().mockResolvedValue({ organization: { name: 'Орг Л' } })
        }
      }
    );
    expect(await resendInvite(prisma, MANAGER_LEADER, { userId: 'u-t' })).toMatchObject({
      ok: true,
      emailStatus: 'sent'
    });
  });

  it('forbidden: обычный manager (без managerRole=leader)', async () => {
    const session: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
    const { prisma } = makePrisma(makeTarget({ role: 'manager', partnerId: null, companyId: 'c1' }));
    expect(await resendInvite(prisma, session, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: менеджер из чужой компании', async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'manager', partnerId: null, companyId: 'c2' }));
    expect(await resendInvite(prisma, MANAGER_LEADER, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('forbidden: leader не может переотправлять не-менеджеру', async () => {
    const { prisma } = makePrisma(
      makeTarget({ role: 'organization', partnerId: null, companyId: 'c1' })
    );
    expect(await resendInvite(prisma, MANAGER_LEADER, { userId: 'u-t' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

// ─── письмо по роли приглашённого ─────────────────────────────────────────────

describe('resendInvite — письмо по роли цели', () => {
  it('partner → sendPartnerInviteEmail с именем партнёра и русской ролью', async () => {
    const { prisma } = makePrisma(makeTarget(), {
      partnerUser: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true, roleInPartner: 'admin' })
      },
      partner: { findUnique: vi.fn().mockResolvedValue({ name: 'ООО Партнёр' }) }
    });
    const res = await resendInvite(prisma, { ...ADMIN, name: 'Иван' }, { userId: 'u-t' });
    expect(res).toMatchObject({ ok: true, emailStatus: 'sent' });
    expect(sendMocks.sendPartnerInviteEmail).toHaveBeenCalledWith({
      to: 'target@x.local',
      partnerName: 'ООО Партнёр',
      roleLabel: 'администратор',
      inviteUrl: expect.stringContaining('token=tok-resend'),
      invitedByName: 'Иван'
    });
    expect(sendMocks.sendOrgInviteEmail).not.toHaveBeenCalled();
    expect(sendMocks.sendAdminUserInviteEmail).not.toHaveBeenCalled();
  });

  it('partner без найденного партнёра/membership → фолбэки «партнёр»/«менеджер»', async () => {
    const { prisma } = makePrisma(makeTarget());
    await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(sendMocks.sendPartnerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ partnerName: 'партнёр', roleLabel: 'менеджер' })
    );
  });

  it('organization → sendOrgInviteEmail с именем организации', async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'organization', partnerId: null }), {
      organizationUser: {
        findFirst: vi.fn().mockResolvedValue({ id: 'ou-1', organization: { name: 'Орг А' } })
      }
    });
    await resendInvite(prisma, ORG_ADMIN, { userId: 'u-t' });
    expect(sendMocks.sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'target@x.local', organizationName: 'Орг А' })
    );
  });

  it('manager → sendManagerInviteEmail с организацией из назначения', async () => {
    const { prisma } = makePrisma(
      makeTarget({ role: 'manager', partnerId: null, companyId: 'c1' }),
      {
        organizationManager: {
          findFirst: vi.fn().mockResolvedValue({ organization: { name: 'Орг М' } })
        }
      }
    );
    await resendInvite(prisma, MANAGER_LEADER, { userId: 'u-t' });
    expect(sendMocks.sendManagerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'target@x.local', organizationName: 'Орг М' })
    );
  });

  it("student → sendAdminUserInviteEmail с role='student'", async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'student', partnerId: null }));
    await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(sendMocks.sendAdminUserInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'target@x.local', name: 'Target', role: 'student' })
    );
  });

  it("роль вне шаблона (admin) → sendAdminUserInviteEmail с фолбэком role='manager'", async () => {
    const { prisma } = makePrisma(makeTarget({ role: 'admin', partnerId: null }));
    const res = await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(res).toMatchObject({ ok: true, emailStatus: 'sent' });
    expect(sendMocks.sendAdminUserInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager' })
    );
  });
});

// ─── sendEmail:false, сбои письма, аудит ──────────────────────────────────────

describe('resendInvite — режимы письма и аудит', () => {
  it("sendEmail:false → письмо не отправляется, emailStatus='skipped'", async () => {
    const { prisma } = makePrisma(makeTarget());
    const res = await resendInvite(prisma, ADMIN, { userId: 'u-t', sendEmail: false });
    expect(res).toEqual({
      ok: true,
      inviteUrl: expect.stringContaining('token=tok-resend'),
      emailStatus: 'skipped'
    });
    expect(sendMocks.sendPartnerInviteEmail).not.toHaveBeenCalled();
    expect(sendMocks.sendOrgInviteEmail).not.toHaveBeenCalled();
    expect(sendMocks.sendManagerInviteEmail).not.toHaveBeenCalled();
    expect(sendMocks.sendAdminUserInviteEmail).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        after: expect.objectContaining({ emailRequested: false, emailStatus: 'skipped' })
      })
    );
  });

  it("сбой отправки письма проглатывается: ok:true, emailStatus='skipped'", async () => {
    sendMocks.sendPartnerInviteEmail.mockRejectedValue(new Error('smtp down'));
    const { prisma } = makePrisma(makeTarget());
    const res = await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(res).toEqual({
      ok: true,
      inviteUrl: expect.stringContaining('token=tok-resend'),
      emailStatus: 'skipped'
    });
    expect(logWarn).toHaveBeenCalled();
  });

  it("транспорт вернул не-sent (email выключен) → emailStatus='skipped'", async () => {
    sendMocks.sendPartnerInviteEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { prisma } = makePrisma(makeTarget());
    expect(await resendInvite(prisma, ADMIN, { userId: 'u-t' })).toMatchObject({
      ok: true,
      emailStatus: 'skipped'
    });
  });

  it('пишет аудит invite_resent с ролью цели и статусом письма', async () => {
    const { prisma } = makePrisma(makeTarget());
    await resendInvite(prisma, ADMIN, { userId: 'u-t' });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'adm-1',
      action: 'invite_resent',
      entity: 'user',
      entityId: 'u-t',
      after: { targetRole: 'partner', emailRequested: true, emailStatus: 'sent' }
    });
  });
});
