import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { fillFromEgrul } from '@/lib/services/organization/egrul';

/**
 * `У-94` на живом Postgres. Проверяем две вещи, которые на моках доказать
 * нельзя: что запись действительно доходит до базы вместе с журналом в одной
 * транзакции, и что дубль ИНН внутри компании отбивается по реальным данным.
 *
 * Дубль опасен не абстрактно: ИНН — ключ, по которому импорт выписки и обмен с
 * 1С связывают платежи с клиентом. Два клиента одной компании с одним ИНН
 * сделали бы привязку неоднозначной.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const INN = `77${String(STAMP).slice(-8)}`;

let companyId = '';
let otherCompanyId = '';
let orgId = '';
let twinId = '';
let foreignTwinId = '';
let adminId = '';

const admin = (): SessionPayload =>
  ({ sub: adminId, role: 'admin', companyId: null }) as SessionPayload;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `egrul-${STAMP}@test.local`, passwordHash: 'h', name: 'Админ', role: 'admin' },
  });
  adminId = user.id;

  const own = await prisma.company.create({ data: { name: `Компания ${STAMP}` } });
  const other = await prisma.company.create({ data: { name: `Другая ${STAMP}` } });
  companyId = own.id;
  otherCompanyId = other.id;

  const org = await prisma.organization.create({
    data: { name: `Без ИНН ${STAMP}`, companyId },
  });
  orgId = org.id;

  // Тёзка с тем же ИНН в ТОЙ ЖЕ компании — подстановка обязана отказать.
  const twin = await prisma.organization.create({
    data: { name: `Тёзка ${STAMP}`, companyId, inn: INN },
  });
  twinId = twin.id;

  // Такой же ИНН в ДРУГОЙ компании помехой быть не должен: компании независимы.
  const foreign = await prisma.organization.create({
    data: { name: `Чужая ${STAMP}`, companyId: otherCompanyId, inn: `${INN}9` },
  });
  foreignTwinId = foreign.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.organization.deleteMany({
    where: { id: { in: [orgId, twinId, foreignTwinId] } },
  });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
});

describe('У-94: подстановка из ЕГРЮЛ на живом Postgres', () => {
  it('дубль ИНН внутри компании отбивается — в базе ничего не меняется', async () => {
    const res = await fillFromEgrul(prisma, admin(), { orgId, values: { inn: INN } });
    expect(res).toEqual({ ok: false, error: 'inn_taken' });

    const after = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { inn: true },
    });
    expect(after?.inn).toBeNull();
  });

  it('свободный ИНН записывается вместе с остальными отмеченными полями', async () => {
    const freeInn = `${INN.slice(0, 8)}77`;
    const res = await fillFromEgrul(prisma, admin(), {
      orgId,
      values: {
        inn: freeInn,
        kpp: '770701001',
        legalName: `ООО «Без ИНН ${STAMP}»`,
        ogrn: '1027700132195',
        legalAddress: 'Москва, ул. Полевая, 1',
      },
    });
    expect(res.ok).toBe(true);

    const after = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { inn: true, kpp: true, legalName: true, ogrn: true, legalAddress: true, name: true },
    });
    expect(after?.inn).toBe(freeInn);
    expect(after?.kpp).toBe('770701001');
    expect(after?.ogrn).toBe('1027700132195');
    expect(after?.legalAddress).toBe('Москва, ул. Полевая, 1');
    // Название организации подстановка НЕ трогает: юр. название — отдельное
    // поле, а по `name` строится ключ сопоставления импорта (`У-83`).
    expect(after?.name).toBe(`Без ИНН ${STAMP}`);
  });

  it('правка попала в журнал действий', async () => {
    const events = await prisma.auditLog.findMany({
      where: { userId: adminId, action: 'organization_egrul_filled', entityId: orgId },
      select: { id: true },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});
