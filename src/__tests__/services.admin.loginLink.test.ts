import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
const { createInviteToken } = vi.hoisted(() => ({ createInviteToken: vi.fn() }));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken }));
const { sendPasswordResetEmail } = vi.hoisted(() => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('@/lib/services/auth/passwordResetRequest', () => ({ sendPasswordResetEmail }));

import {
  issueLoginLink,
  lastLoginEmailAttempt,
  recordLoginEmailAttempt,
} from '@/lib/services/admin/users/loginLink';
import { emailOutcome } from '@/lib/email/outcome';

/**
 * Ссылка входа для существующего пользователя (`У-272`) и честный итог письма
 * (`У-271`, ТЗ 13.10.2026, `Д-54`): на стенде почта не была настроена, а
 * интерфейс об этом молчал.
 */
const ADMIN = { sub: 'a1', role: 'admin' } as SessionPayload;
const EXPIRES = new Date('2026-10-14T12:00:00Z');

function db(user: unknown, lastAudit: unknown = null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const findFirst = vi.fn().mockResolvedValue(lastAudit);
  return {
    prisma: {
      user: { findUnique },
      auditLog: { findFirst },
    } as unknown as PrismaClient,
    findUnique,
    findFirst,
  };
}

const USER = { id: 'u1', email: 'student@x.ru', name: 'Слушатель', isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  createInviteToken.mockResolvedValue({ token: 'tok', expiresAt: EXPIRES });
  sendPasswordResetEmail.mockResolvedValue({ status: 'sent', id: 'm1' });
});

describe('emailOutcome — итог письма словами', () => {
  it('каждая причина пропуска — понятная фраза с тем, где чинить', () => {
    expect(emailOutcome({ status: 'sent', id: null })).toEqual({ status: 'sent' });
    expect(emailOutcome({ status: 'skipped', reason: 'disabled' })).toEqual({
      status: 'not_sent',
      reason: 'отправка писем выключена в «Настройки → Интеграции → Почта»',
    });
    expect(emailOutcome({ status: 'skipped', reason: 'no-api-key' }).status).toBe('not_sent');
    expect(emailOutcome({ status: 'skipped', reason: 'no-recipient' })).toMatchObject({
      reason: 'у пользователя не указан e-mail',
    });
    expect(emailOutcome({ status: 'failed', reason: 'provider' })).toMatchObject({
      reason: 'почтовый сервис отказал в отправке',
    });
    expect(emailOutcome(null)).toMatchObject({ reason: 'сбой при отправке письма' });
  });
});

describe('issueLoginLink (У-272)', () => {
  it('только администратор', async () => {
    const { prisma, findUnique } = db(USER);
    expect(
      await issueLoginLink(
        prisma,
        { sub: 'm1', role: 'manager' } as SessionPayload,
        'u1',
        'https://x'
      )
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('нет пользователя → not_found; отключённый → inactive, ссылку не создаём', async () => {
    expect(await issueLoginLink(db(null).prisma, ADMIN, 'u1', 'https://x')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      await issueLoginLink(db({ ...USER, isActive: false }).prisma, ADMIN, 'u1', 'https://x')
    ).toEqual({ ok: false, error: 'inactive' });
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('существующему — одноразовая ссылка сброса, письмо, итог в журнал пользователя', async () => {
    const { prisma } = db(USER);
    const res = await issueLoginLink(prisma, ADMIN, 'u1', 'https://lk.test');
    expect(res).toEqual({
      ok: true,
      url: 'https://lk.test/reset-password?token=tok',
      expiresAt: EXPIRES,
      email: { status: 'sent' },
    });
    // Тот же механизм, что «Забыли пароль»: короткоживущий reset, не invite.
    expect(createInviteToken).toHaveBeenCalledWith(prisma, 'u1', undefined, 'reset');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      to: 'student@x.ru',
      name: 'Слушатель',
      resetUrl: 'https://lk.test/reset-password?token=tok',
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'a1',
      action: 'login_email_attempt',
      entity: 'user',
      entityId: 'u1',
      after: { kind: 'login_link', status: 'sent' },
    });
  });

  it('почта не настроена — ссылка всё равно есть, итог «не отправлено» с причиной', async () => {
    sendPasswordResetEmail.mockResolvedValue({ status: 'skipped', reason: 'no-api-key' });
    const { prisma } = db(USER);
    const res = await issueLoginLink(prisma, ADMIN, 'u1', 'https://lk.test');
    expect(res).toMatchObject({ ok: true, email: { status: 'not_sent' } });
    expect(recordAudit.mock.calls[0]![1].after).toMatchObject({
      status: 'not_sent',
      reason: 'не задан ключ почтового сервиса в «Настройки → Интеграции → Почта»',
    });
  });

  it('отправка упала исключением — ссылка всё равно выдана', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('network'));
    const res = await issueLoginLink(db(USER).prisma, ADMIN, 'u1', 'https://lk.test');
    expect(res).toMatchObject({
      ok: true,
      email: { status: 'not_sent', reason: 'сбой при отправке письма' },
    });
  });

  it('исключение не-Error значением — тоже не ломает выдачу', async () => {
    sendPasswordResetEmail.mockRejectedValue('boom');
    expect((await issueLoginLink(db(USER).prisma, ADMIN, 'u1', 'https://lk.test')).ok).toBe(true);
  });
});

describe('журнал итога письма', () => {
  it('приглашение пишет kind=invite без причины, если ушло', async () => {
    const { prisma } = db(null);
    await recordLoginEmailAttempt(prisma, {
      actorUserId: 'a1',
      userId: 'u1',
      kind: 'invite',
      outcome: { status: 'sent' },
    });
    expect(recordAudit.mock.calls[0]![1].after).toEqual({ kind: 'invite', status: 'sent' });
  });

  it('последняя попытка читается из журнала; неизвестные поля — честно «не записана»', async () => {
    const at = new Date('2026-10-14T08:00:00Z');
    const sent = await lastLoginEmailAttempt(
      db(null, { createdAt: at, meta: { after: { kind: 'login_link', status: 'sent' } } }).prisma,
      'u1'
    );
    expect(sent).toEqual({ at, kind: 'login_link', outcome: { status: 'sent' } });

    const broken = await lastLoginEmailAttempt(
      db(null, { createdAt: at, meta: null }).prisma,
      'u1'
    );
    expect(broken).toEqual({
      at,
      kind: 'invite',
      outcome: { status: 'not_sent', reason: 'причина не записана' },
    });

    const noAfter = await lastLoginEmailAttempt(db(null, { createdAt: at, meta: {} }).prisma, 'u1');
    expect(noAfter?.kind).toBe('invite');

    const withReason = await lastLoginEmailAttempt(
      db(null, {
        createdAt: at,
        meta: { after: { kind: 'invite', status: 'not_sent', reason: 'нет ключа' } },
      }).prisma,
      'u1'
    );
    expect(withReason?.outcome).toEqual({ status: 'not_sent', reason: 'нет ключа' });
  });

  it('попыток не было — null', async () => {
    const { prisma, findFirst } = db(null, null);
    expect(await lastLoginEmailAttempt(prisma, 'u1')).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { entity: 'user', entityId: 'u1', action: 'login_email_attempt' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, meta: true },
    });
  });
});
