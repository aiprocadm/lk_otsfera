/**
 * Этап 9 (ФТ-11.2) — ревокация сессий через User.sessionVersion, на живой БД.
 *
 * Смысл механизма простыми словами: JWT живёт 7 дней и его нельзя «отозвать»
 * из браузера. Поэтому у пользователя в БД лежит счётчик версии сессии; тот же
 * счётчик кладётся в токен при выдаче. Как только счётчик в БД увеличили
 * (сброс пароля, деактивация, отзыв «выйти со всех устройств»), все ранее
 * выданные токены перестают совпадать с БД — getSession возвращает null.
 *
 * Здесь проверяем именно сквозной путь: настоящая подпись/проверка JWT +
 * настоящий Postgres. Мокается только `next/headers` (getSession читает cookie
 * через него — HTTP-контекста в интеграционном тесте нет).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Секрет обязан быть ≥32 символов (assertSecretStrength в jwt.ts). Выставляем
// до первого обращения к getJwtSecret() — оно ленивое, внутри signToken.
process.env.JWT_SECRET = 'integration_session_revocation_secret_0001';

// Подменяем только чтение cookie: getSession зовёт `cookies()` из next/headers,
// а вне запроса Next такого контекста нет. Токен подкладываем через мутируемый
// объект (vi.hoisted — фабрика vi.mock поднимается наверх файла).
const { cookieState } = vi.hoisted(() => ({ cookieState: { token: null as string | null } }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'session' && cookieState.token !== null ? { value: cookieState.token } : undefined
  }))
}));

import { signToken, type SessionPayload } from '@/lib/auth/jwt';
import { getSession } from '@/lib/auth/session';
import { deactivateMember } from '@/lib/services/organization/team';

let prisma: PrismaClient;

const STAMP = Date.now();
let organizationId: string;
let adminUserId: string;
let adminOrgUserId: string;
let memberUserId: string;
let memberOrgUserId: string;
/** Одиночка для проверок самого механизма версий (не участник организации). */
let soloUserId: string;

/** Свежий токен пользователя: версия читается из БД, как это делает login. */
async function issueToken(userId: string, extra: Partial<SessionPayload> = {}): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sessionVersion: true }
  });
  return signToken({ sub: userId, role: 'organization', sessionVersion: user.sessionVersion, ...extra });
}

async function readSessionVersion(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sessionVersion: true }
  });
  return user.sessionVersion;
}

/** Кладёт токен в «cookie» и спрашивает getSession. */
async function sessionFor(token: string | null) {
  cookieState.token = token;
  return getSession();
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const org = await prisma.organization.create({
    data: { name: `Ревокация ORG ${STAMP}` }
  });
  organizationId = org.id;

  const admin = await prisma.user.create({
    data: {
      email: `revoke-admin-${STAMP}@t.local`,
      name: 'Админ организации',
      role: 'organization',
      passwordHash: 'x',
      organizationId
    }
  });
  adminUserId = admin.id;

  const member = await prisma.user.create({
    data: {
      email: `revoke-member-${STAMP}@t.local`,
      name: 'Участник организации',
      role: 'organization',
      passwordHash: 'x',
      organizationId
    }
  });
  memberUserId = member.id;

  const solo = await prisma.user.create({
    data: {
      email: `revoke-solo-${STAMP}@t.local`,
      name: 'Одиночка',
      role: 'organization',
      passwordHash: 'x'
    }
  });
  soloUserId = solo.id;

  const adminOrgUser = await prisma.organizationUser.create({
    data: { organizationId, userId: adminUserId, roleInOrg: 'admin', isActive: true }
  });
  adminOrgUserId = adminOrgUser.id;

  const memberOrgUser = await prisma.organizationUser.create({
    data: { organizationId, userId: memberUserId, roleInOrg: 'member', isActive: true }
  });
  memberOrgUserId = memberOrgUser.id;
});

afterAll(async () => {
  // Порядок важен: сначала зависимые строки, потом User и Organization.
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminUserId, memberUserId, soloUserId] } } });
  await prisma.organizationUser.deleteMany({ where: { id: { in: [adminOrgUserId, memberOrgUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, memberUserId, soloUserId] } } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe('ревокация сессий по User.sessionVersion (integration)', () => {
  it('свежий токен проходит getSession, а после инкремента версии — уже нет', async () => {
    const oldToken = await issueToken(soloUserId);

    // До инкремента токен рабочий
    const before = await sessionFor(oldToken);
    expect(before).toMatchObject({ sub: soloUserId, role: 'organization', sessionVersion: 0 });

    // Отзываем сессии — ровно так, как это делают точки ревокации в сервисах
    await prisma.user.update({ where: { id: soloUserId }, data: { sessionVersion: { increment: 1 } } });

    // Старый токен подписан валидно, но клейм версии отстал → доступа нет
    expect(await sessionFor(oldToken)).toBeNull();

    // А свежевыданный токен (версия перечитана из БД) снова пускает
    const freshToken = await issueToken(soloUserId);
    expect(freshToken).not.toBe(oldToken);
    expect(await sessionFor(freshToken)).toMatchObject({ sub: soloUserId, sessionVersion: 1 });
  });

  it('легаси-токен без клейма sessionVersion живёт до первого отзыва, потом мертв', async () => {
    // Токен «до релиза ФТ-11.2»: клейма нет вовсе → трактуется как версия 0.
    const legacyToken = await signToken({ sub: adminUserId, role: 'organization' });

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { sessionVersion: true }
    })).toEqual({ sessionVersion: 0 });
    expect(await sessionFor(legacyToken)).toMatchObject({ sub: adminUserId });

    await prisma.user.update({ where: { id: adminUserId }, data: { sessionVersion: { increment: 1 } } });
    expect(await sessionFor(legacyToken)).toBeNull();

    // Возвращаем версию обратно, чтобы не влиять на соседние кейсы
    await prisma.user.update({ where: { id: adminUserId }, data: { sessionVersion: 0 } });
    expect(await sessionFor(legacyToken)).toMatchObject({ sub: adminUserId });
  });

  it('деактивация участника команды организации поднимает sessionVersion и рвёт его сессии', async () => {
    const memberToken = await issueToken(memberUserId);
    expect(await sessionFor(memberToken)).toMatchObject({ sub: memberUserId });

    const versionBefore = await readSessionVersion(memberUserId);

    const res = await deactivateMember(prisma, organizationId, memberOrgUserId, adminUserId, 'admin');
    expect(res).toEqual({ ok: true });

    // Версия в БД выросла — значит все ранее выданные токены протухли
    expect(await readSessionVersion(memberUserId)).toBe(versionBefore + 1);
    expect(await sessionFor(memberToken)).toBeNull();

    // Сама membership тоже погашена (гашение и отзыв идут одной транзакцией)
    const row = await prisma.organizationUser.findUniqueOrThrow({ where: { id: memberOrgUserId } });
    expect(row.isActive).toBe(false);

    // Возвращаем участника в строй для чистоты состояния между кейсами
    await prisma.organizationUser.update({ where: { id: memberOrgUserId }, data: { isActive: true } });
  });

  it('нет cookie → getSession возвращает null (без похода в БД)', async () => {
    expect(await sessionFor(null)).toBeNull();
  });
});
