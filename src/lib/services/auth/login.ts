import bcrypt from 'bcryptjs';
import type { PrismaClient, User } from '@prisma/client';

/**
 * Доступ к БД для потока входа (§3: роут — тонкий, запросы живут в сервисе).
 *
 * Здесь ровно три операции, которые раньше стояли прямо в auth-роутах:
 * проверка пары email+пароль, загрузка активного пользователя по id для
 * второго шага 2FA и best-effort отметка последнего входа.
 *
 * ВАЖНО (безопасность): `authenticateWithPassword` перенесена ДОСЛОВНО, вместе
 * с порядком операций. Порядок — часть контракта:
 *   1) выборка пользователя по email;
 *   2) ветка «аккаунт не активирован» (passwordHash = null) — ДО сравнения;
 *   3) сравнение с реальным хешем либо с DUMMY-хешем, если пользователя нет,
 *      чтобы время ответа не выдавало существование e-mail;
 *   4) единый код `invalid_credentials` и для «нет пользователя», и для
 *      «неверный пароль» — ветки неразличимы снаружи.
 * Не переставляй шаги местами и не «оптимизируй» ранний выход при `!user`:
 * ранний выход вернёт таймингу способность различать существующие e-mail.
 */

const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export type AuthenticateWithPasswordResult =
  { ok: true; user: User } | { ok: false; error: 'account_not_activated' | 'invalid_credentials' };

export async function authenticateWithPassword(
  prisma: PrismaClient,
  args: { email: string; password: string }
): Promise<AuthenticateWithPasswordResult> {
  const user = await prisma.user.findUnique({ where: { email: args.email } });

  if (user && user.passwordHash === null) {
    return { ok: false, error: 'account_not_activated' };
  }

  const hashToCompare = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const ok = await bcrypt.compare(args.password, hashToCompare);

  if (!user || !ok) {
    return { ok: false, error: 'invalid_credentials' };
  }

  return { ok: true, user };
}

export type ActiveUserForSessionResult =
  { ok: true; user: User } | { ok: false; error: 'inactive' };

/**
 * Пользователь второго шага входа (2FA-verify) — целиком, потому что
 * `buildSessionClaims` принимает строку `User`. «Нет строки» и «строка
 * деактивирована» намеренно неразличимы: оба дают один код `inactive`, роут
 * отвечает на него одинаковым 401 SESSION_EXPIRED.
 */
export async function getActiveUserForSession(
  prisma: PrismaClient,
  userId: string
): Promise<ActiveUserForSessionResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return { ok: false, error: 'inactive' };
  return { ok: true, user };
}

export type ActiveUserForCodeDeliveryResult =
  | { ok: true; user: { id: string; email: string; name: string } }
  | { ok: false; error: 'inactive' };

/**
 * Адресат письма с кодом 2FA (переотправка). Узкий select (§13): из строки
 * пользователя нужны только id/имя/адрес — весь `User` тут не нужен.
 */
export async function getActiveUserForCodeDelivery(
  prisma: PrismaClient,
  userId: string
): Promise<ActiveUserForCodeDeliveryResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return { ok: false, error: 'inactive' };
  return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
}

/**
 * Этап 9 (ФТ-11.3): отметка входа. Best-effort (§3) — сбой апдейта не должен
 * лишать пользователя сессии, которую он уже заслужил верным паролем/кодом,
 * поэтому ошибка проглатывается здесь, а не всплывает в роут.
 */
export async function recordLastLogin(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.user
    .update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
    .catch(() => {});
}
