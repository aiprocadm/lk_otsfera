/**
 * `У-275`, `У-279`, `У-281` (ТЗ 13.10.2026, дефект `Д-50`) — на живой БД.
 *
 * Сценарий ПМ: менеджер вошёл, ПОТОМ администратор закрепил за ним организацию.
 * Раньше список закреплённых организаций жил в токене снимком на момент входа:
 * «Организации» были пусты, в «Общих документах» не было контрагентов, а
 * «Создать контакт из данных лида» отвечало «нет доступа» — до повторного входа.
 *
 * Здесь — сквозной путь: настоящая подпись JWT, настоящий Postgres,
 * `getSession` и два настоящих сервиса, которые ПМ упёрлись в снимок.
 * Мокается только `next/headers` (cookie).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

process.env.JWT_SECRET = 'integration_session_fresh_orgs_secret_00001';

const { cookieState } = vi.hoisted(() => ({ cookieState: { token: null as string | null } }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'session' && cookieState.token !== null ? { value: cookieState.token } : undefined,
  })),
}));

import { signToken } from '@/lib/auth/jwt';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';
import { getSession } from '@/lib/auth/session';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { createContact } from '@/lib/services/manager/contacts';

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let otherCompanyId: string;
let managerId: string;
let orgId: string;
let foreignOrgId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `Своя ${STAMP}` } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `Чужая ${STAMP}` } })).id;
  managerId = (
    await prisma.user.create({
      data: {
        email: `fresh-orgs-${STAMP}@test.local`,
        passwordHash: 'h',
        name: 'Менеджер ПМ',
        role: 'manager',
        companyId,
      },
    })
  ).id;
  orgId = (await prisma.organization.create({ data: { name: `ЗАО Энерго ${STAMP}`, companyId } }))
    .id;
  foreignOrgId = (
    await prisma.organization.create({
      data: { name: `Чужая орг ${STAMP}`, companyId: otherCompanyId },
    })
  ).id;

  // Вход ДО назначения: в токене пустой список организаций.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: managerId } });
  const claims = await buildSessionClaims(prisma, user);
  if (!claims.ok) throw new Error('claims');
  expect(claims.claims.managedOrgIds).toEqual([]);
  cookieState.token = await signToken(claims.claims);
});

afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: managerId } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, foreignOrgId] } } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe('назначение организации действует без повторного входа (У-275)', () => {
  it('до назначения — пусто; после — организация в сессии, «Общих документах» и контактах', async () => {
    const before = await getSession();
    expect(before?.managedOrgIds).toEqual([]);

    // Администратор закрепляет организацию — токен менеджера не меняется.
    await prisma.organizationManager.create({
      data: { organizationId: orgId, userId: managerId, isActive: true },
    });
    // Устаревшая строка чужой компании не расширяет скоуп (C8).
    await prisma.organizationManager.create({
      data: { organizationId: foreignOrgId, userId: managerId, isActive: true },
    });

    const session = await getSession();
    expect(session?.managedOrgIds).toEqual([orgId]);

    // `У-279`: контрагенты «Общих документов» — по свежему списку.
    const cps = await listManagerCounterparties(prisma, session!, false);
    expect(cps.organizations.map((o) => o.id)).toEqual([orgId]);

    // `У-281`: контакт с организацией лида создаётся, а не «нет доступа».
    const created = await createContact(prisma, session!, {
      name: 'Иванов Иван',
      organizationId: orgId,
      channels: [{ type: 'phone', value: `+7 900 ${String(STAMP).slice(-7)}` }],
    });
    expect(created.ok).toBe(true);
  });

  it('снятие назначения действует сразу — снимок токена доступ не оставляет', async () => {
    await prisma.organizationManager.updateMany({
      where: { userId: managerId, organizationId: orgId },
      data: { isActive: false },
    });
    const session = await getSession();
    expect(session?.managedOrgIds).toEqual([]);
    const denied = await createContact(prisma, session!, {
      name: 'Петров Пётр',
      organizationId: orgId,
      channels: [],
    });
    expect(denied).toEqual({ ok: false, error: 'forbidden' });
  });
});
