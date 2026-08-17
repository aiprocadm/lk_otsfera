import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listTeam, inviteMember, assignOrgs, deactivateMember } from '@/lib/services/partner/team';

let prisma: PrismaClient;
let partnerId: string;
let orgIds: string[];

beforeAll(async () => {
  prisma = new PrismaClient();
  // Файл использует фиксированные адреса *@x.local — вычищаем хвосты от
  // прошлых упавших прогонов (иначе inviteMember отвечает email_taken).
  const stale = { email: { endsWith: '@x.local' } };
  await prisma.passwordResetToken.deleteMany({ where: { user: stale } });
  await prisma.partnerUser.deleteMany({ where: { user: stale } });
  await prisma.user.deleteMany({ where: stale });
  const p = await prisma.partner.create({ data: { name: 'TeamP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'TeamC-' + Date.now() } });
  const orgA = await prisma.organization.create({
    data: { name: 'TA', partnerId, companyId: c.id },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'TB', partnerId, companyId: c.id },
  });
  orgIds = [orgA.id, orgB.id];
});

afterAll(async () => {
  // Этап 4: inviteMember создаёт invite-токен → чистим до удаления users (FK).
  await prisma.passwordResetToken.deleteMany({ where: { user: { partnerId } } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'TeamC-' } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.passwordResetToken.deleteMany({ where: { user: { partnerId } } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
});

describe('team.listTeam', () => {
  it('returns empty array for empty partner', async () => {
    const team = await listTeam(prisma, partnerId);
    expect(team).toEqual([]);
  });

  it('returns active and inactive members', async () => {
    const u1 = await prisma.user.create({
      data: { email: 't1@x.local', passwordHash: 'h', name: 'U1', role: 'partner', partnerId },
    });
    // Пароль ещё не установлен (пригласили, но не приняли) → invitePending.
    const u2 = await prisma.user.create({
      data: { email: 't2@x.local', passwordHash: null, name: 'U2', role: 'partner', partnerId },
    });
    await prisma.partnerUser.create({
      data: {
        partnerId,
        userId: u1.id,
        roleInPartner: 'admin',
        assignedOrgIds: [],
        isActive: true,
      },
    });
    await prisma.partnerUser.create({
      data: {
        partnerId,
        userId: u2.id,
        roleInPartner: 'manager',
        assignedOrgIds: orgIds,
        isActive: false,
      },
    });

    const team = await listTeam(prisma, partnerId);
    expect(team).toHaveLength(2);
    const adminRow = team.find((t) => t.email === 't1@x.local');
    expect(adminRow?.roleInPartner).toBe('admin');
    expect(adminRow?.isActive).toBe(true);
    // ФТ-10.2: invitePending отражает отсутствие пароля.
    expect(adminRow?.invitePending).toBe(false);
    expect(team.find((t) => t.email === 't2@x.local')?.invitePending).toBe(true);
  });
});

describe('team.inviteMember', () => {
  it('creates User and PartnerUser within a transaction', async () => {
    const result = await inviteMember(prisma, {
      partnerId,
      email: 'new@x.local',
      name: 'Новый менеджер',
      roleInPartner: 'manager',
      assignedOrgIds: [orgIds[0]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.email).toBe('new@x.local');
    expect(result.user.role).toBe('partner');
    expect(result.partnerUser.roleInPartner).toBe('manager');
    expect(result.partnerUser.assignedOrgIds).toEqual([orgIds[0]]);

    // Этап 4 (ФТ-10.1): без временного пароля — invite-токен + ссылка на установку.
    expect(result.user.passwordHash).toBeNull();
    expect(result.inviteUrl).toMatch(/\/reset-password\?token=/);
    const token = await prisma.passwordResetToken.findFirst({
      where: { userId: result.user.id, purpose: 'invite', usedAt: null },
    });
    expect(token).not.toBeNull();

    // ФТ-10.2: пока пароль не установлен, listTeam помечает участника invitePending.
    const team = await listTeam(prisma, partnerId);
    expect(team.find((t) => t.userId === result.user.id)?.invitePending).toBe(true);
  });

  // Все три пути getAppBaseUrl — явно. Раньше ветки «APP_URL задан/не задан»
  // покрывались СЛУЧАЙНО: тесты одного worker-процесса делят process.env, и
  // покрытие зависело от того, какой файл успел выставить/снять переменную
  // раньше. Смена состава тестовых файлов двигала порядок, и гейт 100 % мигал.
  it('inviteUrl: база из APP_URL; пустой/неустановленный APP_URL → дефолт', async () => {
    const prev = process.env.APP_URL;
    try {
      process.env.APP_URL = 'https://app.example.test';
      const withEnv = await inviteMember(prisma, {
        partnerId,
        email: 'url1@x.local',
        name: 'U',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      });
      if (!withEnv.ok) throw new Error('expected ok');
      expect(withEnv.inviteUrl.startsWith('https://app.example.test/reset-password')).toBe(true);

      process.env.APP_URL = '   ';
      const blankEnv = await inviteMember(prisma, {
        partnerId,
        email: 'url2@x.local',
        name: 'U',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      });
      if (!blankEnv.ok) throw new Error('expected ok');
      expect(blankEnv.inviteUrl.startsWith('https://lk.otsfera.ru/reset-password')).toBe(true);

      delete process.env.APP_URL;
      const noEnv = await inviteMember(prisma, {
        partnerId,
        email: 'url3@x.local',
        name: 'U',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      });
      if (!noEnv.ok) throw new Error('expected ok');
      expect(noEnv.inviteUrl.startsWith('https://lk.otsfera.ru/reset-password')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });

  it('rejects duplicate email', async () => {
    await prisma.user.create({
      data: { email: 'dup@x.local', passwordHash: 'h', name: 'D', role: 'partner', partnerId },
    });

    expect(
      await inviteMember(prisma, {
        partnerId,
        email: 'dup@x.local',
        name: 'X',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      })
    ).toEqual({ ok: false, error: 'email_taken' });
  });

  it('rejects assignedOrgIds outside partner', async () => {
    const otherPartner = await prisma.partner.create({ data: { name: 'OthP-' + Date.now() } });
    const c = await prisma.company.create({ data: { name: 'OthC-' + Date.now() } });
    const foreignOrg = await prisma.organization.create({
      data: { name: 'Foreign', partnerId: otherPartner.id, companyId: c.id },
    });

    expect(
      await inviteMember(prisma, {
        partnerId,
        email: 'x@x.local',
        name: 'X',
        roleInPartner: 'manager',
        assignedOrgIds: [foreignOrg.id],
      })
    ).toEqual({ ok: false, error: 'org_out_of_scope' });

    await prisma.organization.delete({ where: { id: foreignOrg.id } });
    await prisma.company.deleteMany({ where: { name: { startsWith: 'OthC-' } } });
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });
});

describe('team.assignOrgs', () => {
  it('replaces assignedOrgIds for an existing member', async () => {
    const u = await prisma.user.create({
      data: { email: 'as@x.local', passwordHash: 'h', name: 'A', role: 'partner', partnerId },
    });
    await prisma.partnerUser.create({
      data: {
        partnerId,
        userId: u.id,
        roleInPartner: 'manager',
        assignedOrgIds: [orgIds[0]],
        isActive: true,
      },
    });

    const updated = await assignOrgs(prisma, { partnerId, userId: u.id, assignedOrgIds: orgIds });
    if (!updated.ok) throw new Error('expected ok');
    expect(updated.partnerUser.assignedOrgIds).toEqual(orgIds);
  });

  it('rejects orgs outside partner', async () => {
    const u = await prisma.user.create({
      data: { email: 'as2@x.local', passwordHash: 'h', name: 'A', role: 'partner', partnerId },
    });
    await prisma.partnerUser.create({
      data: {
        partnerId,
        userId: u.id,
        roleInPartner: 'manager',
        assignedOrgIds: [],
        isActive: true,
      },
    });

    expect(
      await assignOrgs(prisma, { partnerId, userId: u.id, assignedOrgIds: ['no-such-org'] })
    ).toEqual({ ok: false, error: 'org_out_of_scope' });
  });
});

describe('team.deactivateMember', () => {
  it('flips isActive=false', async () => {
    const u = await prisma.user.create({
      data: { email: 'd@x.local', passwordHash: 'h', name: 'D', role: 'partner', partnerId },
    });
    await prisma.partnerUser.create({
      data: {
        partnerId,
        userId: u.id,
        roleInPartner: 'manager',
        assignedOrgIds: [],
        isActive: true,
      },
    });

    const r = await deactivateMember(prisma, { partnerId, userId: u.id });
    if (!r.ok) throw new Error('expected ok');
    expect(r.partnerUser.isActive).toBe(false);
  });

  it('refuses to deactivate the last admin', async () => {
    const u = await prisma.user.create({
      data: { email: 'last@x.local', passwordHash: 'h', name: 'L', role: 'partner', partnerId },
    });
    await prisma.partnerUser.create({
      data: { partnerId, userId: u.id, roleInPartner: 'admin', assignedOrgIds: [], isActive: true },
    });

    expect(await deactivateMember(prisma, { partnerId, userId: u.id })).toEqual({
      ok: false,
      error: 'last_admin_protected',
    });
  });
});
