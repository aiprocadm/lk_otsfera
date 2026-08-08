/**
 * Integration-страж У-4 (этап 1, решение Р-4) на живой Postgres.
 *
 * Юнит-страж (`api.partner.portfolio.rate.test.ts`) доказывает, что роут не
 * зовёт сервис и не трогает призму. Здесь проверяется то же требование
 * сквозным путём — на настоящей базе, с настоящим клиентом призмы:
 *
 *   попытка партнёра сменить ставку → `403`
 *   И в `OrganizationCommissionRateChange` не появилось НИ ОДНОЙ строки
 *   И `Organization.partnerCommissionRate` осталась прежней.
 *
 * Именно этого требует шапка STATUS.md: «один только статус ответа не
 * доказывает, что запись не появилась».
 *
 * Auto-detected as integration (contains `new PrismaClient(`) → гоняется через
 * `npm run test:integration`. Префикс ключей `U4-` — чтобы не столкнуться с
 * другими тестами на общей базе.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { PUT } from '@/app/api/partner/portfolio/[orgId]/rate/route';

const db = new PrismaClient();

const PARTNER_NAME = 'U4-партнёр';
const ORG_NAME = 'U4-организация';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const body = (b: unknown) =>
  new Request('http://x/', {
    method: 'PUT',
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' },
  });

const ADMIN_EMAIL = 'u4-admin@example.test';

async function cleanup() {
  const orgs = await db.organization.findMany({
    where: { name: { startsWith: 'U4-' } },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);
  await db.organizationCommissionRateChange.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  // AuditLog ссылается на пользователя, поэтому чистится до него.
  await db.auditLog.deleteMany({ where: { entityId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { name: { startsWith: 'U4-' } } });
  await db.partner.deleteMany({ where: { name: { startsWith: 'U4-' } } });
  await db.user.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function seed() {
  const partner = await db.partner.create({ data: { name: PARTNER_NAME } });
  const org = await db.organization.create({
    data: { name: ORG_NAME, partnerId: partner.id, partnerCommissionRate: null },
  });
  // Настоящий пользователь нужен из-за FK `AuditLog.userId`: сервис ставки
  // пишет аудит в той же транзакции.
  const admin = await db.user.create({
    data: { email: ADMIN_EMAIL, name: 'U4 админ', role: 'admin' },
  });
  return { partner, org, admin };
}

beforeEach(async () => {
  await cleanup();
  vi.mocked(getSession).mockReset();
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe('У-4: партнёр не может изменить ставку комиссии (живой Postgres)', () => {
  it('партнёр-администратор → 403, история ставок пуста, ставка не изменилась', async () => {
    const { partner, org } = await seed();

    vi.mocked(getSession).mockResolvedValue({
      sub: 'u4-partner-admin',
      role: 'partner',
      partnerId: partner.id,
      partnerRole: 'admin',
    } as never);

    const res = await PUT(body({ rate: 0.5, reason: 'сам себе' }), ctx(org.id));

    expect(res.status).toBe(403);

    const changes = await db.organizationCommissionRateChange.count({
      where: { organizationId: org.id },
    });
    expect(changes).toBe(0);

    const after = await db.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { partnerCommissionRate: true, partnerCommissionRateChangedBy: true },
    });
    expect(after.partnerCommissionRate).toBeNull();
    expect(after.partnerCommissionRateChangedBy).toBeNull();
  });

  it('администратор учебного центра ставку менять может — роут остался рабочим', async () => {
    const { org, admin } = await seed();

    vi.mocked(getSession).mockResolvedValue({ sub: admin.id, role: 'admin' } as never);

    const res = await PUT(body({ rate: 0.085, reason: 'договорная ставка' }), ctx(org.id));

    expect(res.status).toBe(204);

    const after = await db.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { partnerCommissionRate: true, partnerCommissionRateChangedBy: true },
    });
    expect(after.partnerCommissionRate?.toString()).toBe('0.085');
    expect(after.partnerCommissionRateChangedBy).toBe(admin.id);

    const changes = await db.organizationCommissionRateChange.count({
      where: { organizationId: org.id },
    });
    expect(changes).toBe(1);
  });
});
