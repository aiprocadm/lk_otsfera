import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { findByInn } from '@/lib/services/duplicates/findByInn';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 5 PR-2 (ФТ-13.4): интеграционный прогон антидублей по ИНН на живом
 * Postgres (эталон — services.clientRequests.integration.test.ts):
 *  - организация с ИНН находится по точному совпадению;
 *  - лид rejected НЕ попадает в выдачу, лид new — попадает;
 *  - клиентская (партнёрская) сессия → forbidden реальным вызовом сервиса;
 *  - 9-значный ИНН → validation.
 *
 * Фикстуры self-seeded с префиксом dup5-int, ИНН уникален на прогон (уникальный
 * констрейнт Organization.inn); cleanup в beforeAll (хвосты) и afterAll.
 * Запуск: npx vitest run --mode=integration <файл>.
 */

const prisma = new PrismaClient();
const T = 'dup5-int';
const RUN = Date.now().toString(36);
// 10 значащих цифр, уникальные на прогон (Organization.inn @unique).
const INN = `99${Date.now().toString().slice(-8)}`;

const STAFF_USER = `${T}-mgr-${RUN}`;

let orgId = '';
let leadNewId = '';
let leadRejectedId = '';

const managerSession = { sub: STAFF_USER, role: 'manager', companyId: null } as SessionPayload;
const partnerSession = {
  sub: `${T}-partner-${RUN}`,
  role: 'partner',
  partnerId: 'nope',
} as SessionPayload;

async function cleanup(): Promise<void> {
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: T } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: T } } });
}

beforeAll(async () => {
  await cleanup(); // хвосты упавших прогонов

  const org = await prisma.organization.create({
    data: { name: `${T}-Организация-${RUN}`, inn: INN },
  });
  orgId = org.id;

  await prisma.user.create({
    data: {
      id: STAFF_USER,
      email: `${STAFF_USER}@dup5.test`,
      name: 'DUP5 Менеджер',
      role: 'manager',
    },
  });

  const leadNew = await prisma.lead.create({
    data: {
      clientCompanyName: `${T}-Компания-нью-${RUN}`,
      clientInn: INN,
      clientContactName: 'Иван',
      subject: `${T} активный лид`,
      status: 'new',
      createdByUserId: STAFF_USER,
    },
  });
  leadNewId = leadNew.id;

  const leadRejected = await prisma.lead.create({
    data: {
      clientCompanyName: `${T}-Компания-отказ-${RUN}`,
      clientInn: INN,
      clientContactName: 'Пётр',
      subject: `${T} отклонённый лид`,
      status: 'rejected',
      rejectedReason: 'дубль',
      createdByUserId: STAFF_USER,
    },
  });
  leadRejectedId = leadRejected.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('findByInn — живой Postgres (dup5-int)', () => {
  it('менеджер находит организацию по точному ИНН (id + name, без лишних полей)', async () => {
    const res = await findByInn(prisma, managerSession, { inn: INN });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicates.organizations).toEqual([{ id: orgId, name: `${T}-Организация-${RUN}` }]);
  });

  it('лид new находится, лид rejected — нет', async () => {
    const res = await findByInn(prisma, managerSession, { inn: INN });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.duplicates.leads.map((l) => l.id);
    expect(ids).toContain(leadNewId);
    expect(ids).not.toContain(leadRejectedId);
    const active = res.duplicates.leads.find((l) => l.id === leadNewId);
    expect(active).toEqual({ id: leadNewId, subject: `${T} активный лид`, status: 'new' });
  });

  it('нормализованный ввод (пробелы/дефисы) находит ту же организацию', async () => {
    const spaced = `${INN.slice(0, 4)} ${INN.slice(4, 7)}-${INN.slice(7)}`;
    const res = await findByInn(prisma, managerSession, { inn: spaced });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicates.organizations.map((o) => o.id)).toContain(orgId);
  });

  it('ФТ-13.4: партнёрская сессия → forbidden (факт наличия ИНН не раскрывается)', async () => {
    const res = await findByInn(prisma, partnerSession, { inn: INN });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('9-значный ИНН → validation', async () => {
    const res = await findByInn(prisma, managerSession, { inn: '123456789' });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });
});
