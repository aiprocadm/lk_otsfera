import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  claimEnrollment,
  claimInbound,
  claimCall,
  closeCallIntake,
} from '@/lib/services/intake/claim';
import { createLeadFromInbound, createLeadFromCall } from '@/lib/services/intake/convert';
import { listIntake, countIntake } from '@/lib/services/intake/list';
import { getStaffBadges } from '@/lib/services/intake/badges';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 7 PR-2 (ФТ-8.1/8.2, ФТ-1.6) — Intake на живом Postgres: попадание
 * источников в union, claim с already_assigned, конверсия обращения в лид
 * (bound + выход из Intake), звонок → лид/закрытие, счётчики бейджей.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let m1: string, m2: string;
let inboundId: string, callId: string, callSpamId: string;

const sM1 = (): SessionPayload =>
  ({
    sub: m1,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const sM2 = (): SessionPayload =>
  ({
    sub: m2,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const sPartner = (): SessionPayload =>
  ({ sub: 'px', role: 'partner' }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s7p2-${STAMP}` } })).id;
  m1 = (
    await prisma.user.create({
      data: { email: `s7p2-m1-${STAMP}@t.local`, name: 'М1', role: 'manager', companyId: companyA },
    })
  ).id;
  m2 = (
    await prisma.user.create({
      data: { email: `s7p2-m2-${STAMP}@t.local`, name: 'М2', role: 'manager', companyId: companyA },
    })
  ).id;

  inboundId = (
    await prisma.inboundMessage.create({
      data: {
        channel: 'email',
        externalId: `s7p2-in-${STAMP}`,
        senderRef: `client-${STAMP}@x.ru`,
        senderDisplay: 'Клиент Иванов',
        subject: `s7p2-subject-${STAMP}`,
        body: 'Хотим обучение',
      },
    })
  ).id;
  callId = (
    await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `s7p2-c1-${STAMP}`,
        direction: 'inbound',
        callerNumber: '+79990001122',
        status: 'answered',
      },
    })
  ).id;
  callSpamId = (
    await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `s7p2-c2-${STAMP}`,
        direction: 'inbound',
        callerNumber: '+79990003344',
        status: 'missed',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.lead.deleteMany({
    where: { OR: [{ sourceInboundId: inboundId }, { sourceCallId: callId }] },
  });
  await prisma.inboundMessage.deleteMany({ where: { id: inboundId } });
  await prisma.call.deleteMany({ where: { id: { in: [callId, callSpamId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('полный путь Intake', () => {
  it('источники видны в union; клиентская роль — forbidden', async () => {
    const res = await listIntake(prisma, sM1(), { pageSize: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.result.items.map((i) => i.id);
    expect(ids).toContain(inboundId);
    expect(ids).toContain(callId);
    const inboundItem = res.result.items.find((i) => i.id === inboundId)!;
    expect(inboundItem.from).toBe('Клиент Иванов');
    expect(inboundItem.leadPrefill?.contactEmail).toBe(`client-${STAMP}@x.ru`);

    expect(await listIntake(prisma, sPartner())).toEqual({ ok: false, error: 'forbidden' });
  });

  it('claim обращения: m1 берёт, m2 получает already_assigned, повтор m1 идемпотентен', async () => {
    expect(await claimInbound(prisma, sM1(), { id: inboundId })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await claimInbound(prisma, sM2(), { id: inboundId })).toEqual({
      ok: false,
      error: 'already_assigned',
    });
    expect(await claimInbound(prisma, sM1(), { id: inboundId })).toEqual({
      ok: true,
      changed: false,
    });

    const res = await listIntake(prisma, sM1(), { pageSize: 100 });
    const item = res.ok ? res.result.items.find((i) => i.id === inboundId) : null;
    expect(item?.responsibleName).toBe('М1');
  });

  it('обращение → лид: bound, покидает Intake, повтор → already_converted', async () => {
    const before = await countIntake(prisma, sM1());
    const r = await createLeadFromInbound(prisma, sM1(), {
      inboundId,
      input: {
        companyName: 'ООО Клиент',
        contactName: 'Иванов',
        contactEmail: `client-${STAMP}@x.ru`,
        subject: 'Обучение по ОТ',
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead.source).toBe('inbound_message');
    expect(r.lead.sourceInboundId).toBe(inboundId);

    const msg = await prisma.inboundMessage.findUnique({ where: { id: inboundId } });
    expect(msg!.status).toBe('bound');
    expect(msg!.companyId).toBe(companyA);

    expect(await countIntake(prisma, sM1())).toBe(before - 1);

    const again = await createLeadFromInbound(prisma, sM1(), {
      inboundId,
      input: { companyName: 'X', contactName: 'Y', contactPhone: '+70000000000', subject: 'Z' },
    });
    // bound-сообщение своей компании остаётся в scope → повтор ловится @unique-связью.
    expect(again).toEqual({ ok: false, error: 'already_converted' });
  });

  it('звонок → лид (source=call, claim), второй звонок закрывается «Закрыть»', async () => {
    const r = await createLeadFromCall(prisma, sM1(), {
      callId,
      input: {
        companyName: 'Звонивший',
        contactName: '+79990001122',
        contactPhone: '+79990001122',
        subject: 'Входящий звонок',
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lead.sourceCallId).toBe(callId);
    const call = await prisma.call.findUnique({ where: { id: callId } });
    expect(call!.claimedByUserId).toBe(m1);

    // Лид существует → звонок вне Intake.
    const list = await listIntake(prisma, sM1(), { pageSize: 100 });
    expect(list.ok && list.result.items.map((i) => i.id)).not.toContain(callId);

    // Спам-звонок: claim m2 → закрытие.
    expect(await claimCall(prisma, sM2(), { id: callSpamId })).toEqual({ ok: true, changed: true });
    expect(await closeCallIntake(prisma, sM2(), { id: callSpamId })).toEqual({
      ok: true,
      changed: true,
    });
    const list2 = await listIntake(prisma, sM1(), { pageSize: 100 });
    expect(list2.ok && list2.result.items.map((i) => i.id)).not.toContain(callSpamId);
  });

  it('claimEnrollment гейтится ролью; бейджи считаются', async () => {
    expect(await claimEnrollment(prisma, sPartner(), { id: 'whatever' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const badges = await getStaffBadges(prisma, sM1());
    expect(typeof badges.intake).toBe('number');
    expect(typeof badges.tasksOverdue).toBe('number');
  });
});
