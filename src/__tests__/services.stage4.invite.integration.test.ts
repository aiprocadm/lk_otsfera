import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inviteMember } from '@/lib/services/partner/team';
import { resendInvite } from '@/lib/services/team/resend';
import { peekTokenPurpose, verifyAndConsumeToken } from '@/lib/auth/passwordReset';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 4: интеграционный прогон invite-онбординга на живом Postgres
 * (эталон — services.enrollments.pr2.integration.test.ts):
 *  - inviteMember партнёра: user без пароля + invite-токен + ссылка;
 *  - resendInvite: гашение старого токена, живой новый, already_active
 *    после установки пароля;
 *  - peekTokenPurpose: читает назначение, НЕ гася токен;
 *  - User.welcomeSeenAt: колонка на месте, default null, update работает.
 *
 * Фикстуры self-seeded с префиксом stage4-int; id/email уникальны на прогон
 * (RUN-суффикс), чтобы (а) не ловить email_taken от хвостов упавших прогонов
 * и (б) не аккумулировать rate-limit `invite-resend:<sub>` в Redis между
 * прогонами (лимит 5/час на сессию; здесь ≤4 вызова). rateLimit в integration
 * не мокается. Письма не шлются: inviteMember их не шлёт вовсе (шлёт роут),
 * resendInvite зовём с sendEmail:false.
 */

const prisma = new PrismaClient();
const T = 'stage4-int';
const RUN = Date.now().toString(36);
const ADMIN_ID = `${T}-admin-${RUN}`;

let partnerId = '';
let invitedUserId = '';
let firstInviteUrl = '';
let secondInviteUrl = '';

const adminSession = { sub: ADMIN_ID, role: 'admin', name: 'Stage4 Админ' } as SessionPayload;

function tokenFromUrl(url: string): string {
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`no token in inviteUrl: ${url}`);
  return token;
}

async function cleanup(): Promise<void> {
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: { startsWith: T } } } });
  await prisma.notification.deleteMany({ where: { user: { email: { startsWith: T } } } });
  await prisma.auditLog.deleteMany({ where: { user: { email: { startsWith: T } } } });
  await prisma.partnerUser.deleteMany({ where: { partner: { name: { startsWith: T } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: T } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: T } } });
}

beforeAll(async () => {
  await cleanup(); // хвосты упавших прогонов не должны мешать текущему

  const partner = await prisma.partner.create({ data: { name: `${T}-Партнёр` } });
  partnerId = partner.id;

  await prisma.user.create({
    data: {
      id: ADMIN_ID,
      email: `${T}-admin-${RUN}@stage4.test`,
      name: 'Stage4 Админ',
      role: 'admin',
      passwordHash: 'stage4-int-admin-hash',
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('этап 4: invite-онбординг (integration, живой Postgres)', () => {
  it('partner inviteMember: user без пароля + PasswordResetToken purpose=invite, ссылка на /reset-password', async () => {
    const res = await inviteMember(prisma, {
      partnerId,
      email: `${T}-invited-${RUN}@stage4.test`,
      name: 'Приглашённый Партнёрец',
      roleInPartner: 'manager',
      assignedOrgIds: [],
    });
    if (!res.ok) throw new Error(`inviteMember failed: ${JSON.stringify(res)}`);
    invitedUserId = res.user.id;
    firstInviteUrl = res.inviteUrl;

    expect(res.user.passwordHash).toBeNull();
    expect(res.inviteUrl).toContain('/reset-password?token=');

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: invitedUserId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].purpose).toBe('invite');
    expect(tokens[0].usedAt).toBeNull();
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    // В БД лежит хеш, не плейнтекст из ссылки.
    expect(tokens[0].token).not.toBe(tokenFromUrl(firstInviteUrl));
  });

  it('peekTokenPurpose: invite-токен → {valid:true, purpose:invite} и НЕ гасится (usedAt остаётся null)', async () => {
    const peek = await peekTokenPurpose(prisma, tokenFromUrl(firstInviteUrl));
    expect(peek).toEqual({ valid: true, purpose: 'invite' });

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: invitedUserId } });
    expect(tokens.map((t) => t.usedAt)).toEqual([null]);

    // Мусорный токен — valid:false без падения.
    expect(await peekTokenPurpose(prisma, 'no-such-token')).toEqual({
      valid: false,
      purpose: null,
    });
  });

  it('resendInvite (admin): старый токен погашен, новый живой, ссылка другая', async () => {
    const res = await resendInvite(prisma, adminSession, {
      userId: invitedUserId,
      sendEmail: false,
    });
    if (!res.ok) throw new Error(`resendInvite failed: ${JSON.stringify(res)}`);
    secondInviteUrl = res.inviteUrl;

    expect(res.emailStatus).toBe('skipped'); // sendEmail:false → письмо не запрашивалось
    expect(secondInviteUrl).toContain('/reset-password?token=');
    expect(tokenFromUrl(secondInviteUrl)).not.toBe(tokenFromUrl(firstInviteUrl));

    // Старая ссылка мертва (usedAt проставлен), новая — единственная живая.
    expect(await peekTokenPurpose(prisma, tokenFromUrl(firstInviteUrl))).toEqual({
      valid: false,
      purpose: null,
    });
    expect(await peekTokenPurpose(prisma, tokenFromUrl(secondInviteUrl))).toEqual({
      valid: true,
      purpose: 'invite',
    });

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: invitedUserId },
      orderBy: { createdAt: 'asc' },
    });
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1);

    // Аудит-след пере-отправки записан.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'invite_resent', entityId: invitedUserId, userId: ADMIN_ID },
    });
    expect(audit).not.toBeNull();
  });

  it('verifyAndConsumeToken по новой ссылке ставит пароль и гасит токен', async () => {
    const consumed = await verifyAndConsumeToken(
      prisma,
      tokenFromUrl(secondInviteUrl),
      'stage4-int-new-hash'
    );
    expect(consumed).toEqual({ ok: true, userId: invitedUserId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: invitedUserId } });
    expect(user.passwordHash).toBe('stage4-int-new-hash');

    // Погашенный токен: peek → invalid, повторный consume → used.
    expect(await peekTokenPurpose(prisma, tokenFromUrl(secondInviteUrl))).toEqual({
      valid: false,
      purpose: null,
    });
    expect(await verifyAndConsumeToken(prisma, tokenFromUrl(secondInviteUrl), 'x')).toEqual({
      ok: false,
      reason: 'used',
    });
  });

  it('повторный resendInvite после установки пароля → already_active, новых токенов нет', async () => {
    const res = await resendInvite(prisma, adminSession, {
      userId: invitedUserId,
      sendEmail: false,
    });
    expect(res).toEqual({ ok: false, error: 'already_active' });

    const count = await prisma.passwordResetToken.count({ where: { userId: invitedUserId } });
    expect(count).toBe(2); // оба старых, оба погашены — ничего не добавилось
  });

  it('User.welcomeSeenAt: по умолчанию null, update проставляет отметку', async () => {
    const fresh = await prisma.user.findUniqueOrThrow({
      where: { id: invitedUserId },
      select: { welcomeSeenAt: true },
    });
    expect(fresh.welcomeSeenAt).toBeNull();

    const seenAt = new Date();
    await prisma.user.update({ where: { id: invitedUserId }, data: { welcomeSeenAt: seenAt } });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: invitedUserId },
      select: { welcomeSeenAt: true },
    });
    expect(updated.welcomeSeenAt).not.toBeNull();
    expect(Math.abs(updated.welcomeSeenAt!.getTime() - seenAt.getTime())).toBeLessThan(1000);
  });
});
