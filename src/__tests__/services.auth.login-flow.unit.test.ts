import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Сервисный слой потока входа (аудит A1: prisma-запросы уехали из auth-роутов
 * в `services/auth/login.ts` и `services/auth/twoFactor.ts`).
 *
 * Здесь проверяются именно аргументы prisma-запросов и порядок операций —
 * то, что раньше проверялось на уровне роутов. Ответы/статусы по-прежнему
 * закреплены route-тестами (api.auth.*).
 */

const { findUnique, update, chDelete, compare } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  chDelete: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('bcryptjs', () => ({ default: { compare } }));

import {
  authenticateWithPassword,
  getActiveUserForCodeDelivery,
  getActiveUserForSession,
  recordLastLogin,
} from '@/lib/services/auth/login';
import { discardTwoFactorChallenge } from '@/lib/services/auth/twoFactor';

const prisma = {
  user: { findUnique, update },
  twoFactorChallenge: { delete: chDelete },
} as never;

const USER = {
  id: 'u1',
  email: 'm@x.ru',
  name: 'М',
  role: 'manager',
  passwordHash: 'stored-hash',
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  compare.mockResolvedValue(true);
});

describe('authenticateWithPassword', () => {
  it('ищет пользователя ровно по e-mail и отдаёт строку при верном пароле', async () => {
    findUnique.mockResolvedValue(USER);

    const res = await authenticateWithPassword(prisma, { email: 'm@x.ru', password: 'pw' });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'm@x.ru' } });
    expect(compare).toHaveBeenCalledWith('pw', 'stored-hash');
    expect(res).toEqual({ ok: true, user: USER });
  });

  it('неверный пароль → invalid_credentials', async () => {
    findUnique.mockResolvedValue(USER);
    compare.mockResolvedValue(false);

    expect(await authenticateWithPassword(prisma, { email: 'm@x.ru', password: 'bad' })).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('несуществующий e-mail → тот же invalid_credentials, но сравнение ВСЁ РАВНО выполняется', async () => {
    // Защита от перечисления по таймингу: без сравнения с DUMMY-хешем ответ на
    // несуществующий адрес приходил бы заметно быстрее.
    findUnique.mockResolvedValue(null);
    compare.mockResolvedValue(false);

    const res = await authenticateWithPassword(prisma, { email: 'ghost@x.ru', password: 'pw' });

    expect(res).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![1]).toMatch(/^\$2a\$10\$/);
  });

  it('аккаунт без пароля (приглашение не активировано) → account_not_activated ДО сравнения', async () => {
    findUnique.mockResolvedValue({ ...USER, passwordHash: null });

    const res = await authenticateWithPassword(prisma, { email: 'm@x.ru', password: 'pw' });

    expect(res).toEqual({ ok: false, error: 'account_not_activated' });
    expect(compare).not.toHaveBeenCalled();
  });
});

describe('getActiveUserForSession', () => {
  it('отдаёт строку целиком (её ждёт buildSessionClaims)', async () => {
    findUnique.mockResolvedValue(USER);

    const res = await getActiveUserForSession(prisma, 'u1');

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(res).toEqual({ ok: true, user: USER });
  });

  it.each([
    ['строки нет', null],
    ['строка деактивирована', { ...USER, isActive: false }],
  ])('%s → inactive (ветки снаружи неразличимы)', async (_label, row) => {
    findUnique.mockResolvedValue(row);
    expect(await getActiveUserForSession(prisma, 'u1')).toEqual({ ok: false, error: 'inactive' });
  });
});

describe('getActiveUserForCodeDelivery', () => {
  it('узкий select: только id/email/name (+ isActive для проверки)', async () => {
    findUnique.mockResolvedValue({ id: 'u1', email: 'm@x.ru', name: 'М', isActive: true });

    const res = await getActiveUserForCodeDelivery(prisma, 'u1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, name: true, isActive: true },
    });
    expect(res).toEqual({ ok: true, user: { id: 'u1', email: 'm@x.ru', name: 'М' } });
  });

  it.each([
    ['строки нет', null],
    ['строка деактивирована', { id: 'u1', email: 'm@x.ru', name: 'М', isActive: false }],
  ])('%s → inactive', async (_label, row) => {
    findUnique.mockResolvedValue(row);
    expect(await getActiveUserForCodeDelivery(prisma, 'u1')).toEqual({
      ok: false,
      error: 'inactive',
    });
  });
});

describe('recordLastLogin', () => {
  it('ставит отметку «сейчас» по id пользователя', async () => {
    update.mockResolvedValue({});
    const before = Date.now();

    await recordLastLogin(prisma, 'u1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    const { lastLoginAt } = update.mock.calls[0]![0].data as { lastLoginAt: Date };
    expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastLoginAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('сбой апдейта проглатывается (best-effort §3): вызов не бросает, но пишет warn (В-1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('db down');
    update.mockRejectedValue(err);
    await expect(recordLastLogin(prisma, 'u1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[auth/login] recordLastLogin failed', err);
    warn.mockRestore();
  });
});

describe('discardTwoFactorChallenge', () => {
  it('удаляет челлендж пользователя', async () => {
    chDelete.mockResolvedValue(undefined);

    await discardTwoFactorChallenge(prisma, 'u1');

    expect(chDelete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('удаление несуществующей записи не бросает (иначе 502 «письмо не ушло» стал бы 500)', async () => {
    chDelete.mockRejectedValue(new Error('record not found'));
    await expect(discardTwoFactorChallenge(prisma, 'u1')).resolves.toBeUndefined();
  });
});
