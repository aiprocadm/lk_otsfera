import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrgHistory } from '@/lib/services/organization/orgHistory';

/**
 * Единая лента «История» на живом Postgres (этап 1 ТЗ 12.09.2026, `У-184`,
 * спека §3.8): пять источников сливаются по времени, `total` — сумма
 * счётчиков, по типу — точные страницы; партнёр и чужая компания получают
 * `not_found`. Флаги мессенджеров и телефонии включаются через окружение.
 */
const prisma = new PrismaClient();
const STAMP = `hist${Date.now()}`;
const ORIGINAL_ENV = { ...process.env };

let companyId: string;
let orgId: string;
let managerId: string;
let colleagueId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId],
  }) as unknown as SessionPayload;

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

beforeAll(async () => {
  process.env.FEATURE_INBOUND_MESSAGING = '1';
  process.env.FEATURE_TELEPHONY_MANGO = '1';
  const co = await prisma.company.create({
    data: { name: `${STAMP}-co`, managerTeamVisibility: true },
  });
  companyId = co.id;
  const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId } });
  orgId = org.id;
  const [mgr, col] = await Promise.all([
    prisma.user.create({
      data: { email: `${STAMP}-m@t.test`, name: `${STAMP}-Менеджер`, role: 'manager', companyId },
    }),
    prisma.user.create({
      data: { email: `${STAMP}-c@t.test`, name: `${STAMP}-Коллега`, role: 'manager', companyId },
    }),
  ]);
  managerId = mgr.id;
  colleagueId = col.id;

  await prisma.auditLog.create({
    data: {
      userId: managerId,
      action: 'organization_updated',
      entity: 'organization',
      entityId: orgId,
      createdAt: at(50),
    },
  });
  await prisma.organizationNote.create({
    data: {
      companyId,
      organizationId: orgId,
      authorId: colleagueId,
      body: 'Договорились о скидке',
      createdAt: at(40),
    },
  });
  await prisma.messengerDialog.create({
    data: {
      channel: 'telegram',
      peerRef: `${STAMP}-peer`,
      peerDisplay: 'Иван',
      companyId,
      organizationId: orgId,
      lastMessageAt: at(30),
      lastMessagePreview: 'Здравствуйте',
    },
  });
  await prisma.call.create({
    data: {
      provider: 'mango',
      externalId: `${STAMP}:call`,
      direction: 'inbound',
      callerNumber: '+79210000003',
      status: 'completed',
      companyId,
      resolvedOrgId: orgId,
      startedAt: at(20),
      durationSec: 45,
    },
  });
  await prisma.inboundMessage.create({
    data: {
      channel: 'email',
      externalId: `${STAMP}:in`,
      senderRef: `${STAMP}@t.test`,
      senderDisplay: 'Пётр',
      subject: 'Вопрос по счёту',
      body: 'текст',
      companyId,
      resolvedOrgId: orgId,
      status: 'bound',
      createdAt: at(10),
    },
  });
});

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV };
  await prisma.auditLog.deleteMany({ where: { userId: { in: [managerId, colleagueId] } } });
  await prisma.organizationNote.deleteMany({ where: { companyId } });
  await prisma.messengerDialog.deleteMany({ where: { companyId } });
  await prisma.call.deleteMany({ where: { companyId } });
  await prisma.inboundMessage.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, colleagueId] } } });
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('listOrgHistory (У-184)', () => {
  it('«Все типы»: пять источников слиты по времени, новое сверху, total — сумма', async () => {
    const res = await listOrgHistory(prisma, manager(), { orgId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('top');
    expect(res.total).toBe(5);
    expect(res.items.map((i) => i.kind)).toEqual(['inbound', 'call', 'dialog', 'note', 'audit']);
    expect(res.items.map((i) => i.title)).toEqual([
      'Вопрос по счёту',
      'Входящий звонок',
      'Диалог в Telegram',
      'Заметка',
      'Изменение организации',
    ]);
    expect(res.items[1]!.subtitle).toBe('+79210000003 · 45 с');
    expect(res.items[2]!.actor).toBe('Иван');
    expect(res.items[3]!.actor).toBe(`${STAMP}-Коллега`);
  });

  it('по типу — точная страница: skip за пределами даёт пусто, total прежний', async () => {
    const notes = await listOrgHistory(prisma, manager(), { orgId, type: 'note' });
    expect(notes).toMatchObject({ ok: true, mode: 'exact', total: 1 });
    if (!notes.ok) return;
    expect(notes.items[0]!.subtitle).toBe('Договорились о скидке');
    const page2 = await listOrgHistory(prisma, manager(), { orgId, type: 'note', skip: 20 });
    expect(page2).toMatchObject({ ok: true, total: 1, items: [] });
  });

  it('партнёр и чужая компания → not_found', async () => {
    const partner = {
      sub: 'p',
      role: 'partner',
      companyId,
      partnerId: 'x',
    } as unknown as SessionPayload;
    expect(await listOrgHistory(prisma, partner, { orgId })).toEqual({
      ok: false,
      error: 'not_found',
    });
    const stranger = {
      sub: 's',
      role: 'leader',
      companyId: 'other-co',
    } as unknown as SessionPayload;
    expect(await listOrgHistory(prisma, stranger, { orgId })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
