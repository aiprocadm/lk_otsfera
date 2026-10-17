import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Role } from '@prisma/client';
import { createGroupChat, listConversations } from '@/lib/services/staffChat/conversations';
import { listStaffMessages, sendStaffMessage } from '@/lib/services/staffChat/messages';

/**
 * Свои чаты команды (этап 7 ТЗ 13.10.2026, `У-315`, `Р-7-3`) против живой
 * базы. Главный инвариант — **чат видят только участники**: сотрудник той же
 * компании, которого не позвали, не видит ни чат в списке, ни сообщения по
 * id, ни права писать туда. Края: участник из чужой компании, неактивный,
 * клиентская роль, пустое название, никого не позвали.
 */
const prisma = new PrismaClient();
const S = `stGrp${Date.now()}${Math.floor(Math.random() * 1e4)}`;
let companyA: string;
let companyB: string;
let owner: string;
let member: string;
let outsider: string;
let foreign: string;
let inactive: string;
let leader: string;

const mgr = (sub: string, companyId: string, role = 'manager') =>
  ({ sub, role, companyId }) as never;

async function user(name: string, companyId: string, role: Role = 'manager', isActive = true) {
  return (
    await prisma.user.create({
      data: { email: `${S}-${name}@x.local`, name: `${name} ${S}`, role, companyId, isActive },
    })
  ).id;
}

beforeAll(async () => {
  companyA = (await prisma.company.create({ data: { name: `${S}-A` } })).id;
  companyB = (await prisma.company.create({ data: { name: `${S}-B` } })).id;
  owner = await user('owner', companyA);
  member = await user('member', companyA);
  outsider = await user('outsider', companyA);
  leader = await user('leader', companyA, 'leader');
  foreign = await user('foreign', companyB);
  inactive = await user('inactive', companyA, 'manager', false);
});

afterAll(async () => {
  const convs = await prisma.staffConversation.findMany({
    where: { companyId: { in: [companyA, companyB] } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.staffMessageRead.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.staffMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.staffParticipant.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.staffConversation.deleteMany({ where: { id: { in: ids } } });
  const users = [owner, member, outsider, leader, foreign, inactive];
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('createGroupChat (`У-315`)', () => {
  let groupId = '';

  it('создаёт чат с названием; создатель — участник; руководитель своей компании — можно', async () => {
    const res = await createGroupChat(prisma, mgr(owner, companyA), {
      title: '  Отдел продаж  ',
      participantIds: [member, leader, member, owner],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    groupId = res.conversationId;
    const conv = await prisma.staffConversation.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        kind: true,
        title: true,
        companyId: true,
        participants: { select: { userId: true } },
      },
    });
    expect(conv).toMatchObject({ kind: 'group', title: 'Отдел продаж', companyId: companyA });
    expect(conv.participants.map((p) => p.userId).sort()).toEqual([owner, member, leader].sort());
  });

  it('участник видит чат в списке под его названием и может писать', async () => {
    const list = await listConversations(prisma, mgr(member, companyA));
    expect(list.rows.find((r) => r.id === groupId)).toMatchObject({
      kind: 'group',
      title: 'Отдел продаж',
      companyName: null,
    });
    const sent = await sendStaffMessage(prisma, mgr(member, companyA), {
      conversationId: groupId,
      body: 'Привет, отдел',
    });
    expect(sent.ok).toBe(true);
    const msgs = await listStaffMessages(prisma, mgr(owner, companyA), { conversationId: groupId });
    expect(msgs.ok && msgs.rows.map((m) => m.body)).toEqual(['Привет, отдел']);
  });

  it('сотрудник той же компании, которого не позвали, — не видит и не пишет', async () => {
    const list = await listConversations(prisma, mgr(outsider, companyA));
    expect(list.rows.some((r) => r.id === groupId)).toBe(false);
    const msgs = await listStaffMessages(prisma, mgr(outsider, companyA), {
      conversationId: groupId,
    });
    expect(msgs.ok).toBe(false);
    const sent = await sendStaffMessage(prisma, mgr(outsider, companyA), {
      conversationId: groupId,
      body: 'я тут',
    });
    expect(sent).toEqual({ ok: false, error: 'forbidden' });
  });

  it('участник чужой компании — отказ; неактивный или несуществующий — «не найден»', async () => {
    expect(
      await createGroupChat(prisma, mgr(owner, companyA), { title: 'X', participantIds: [foreign] })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await createGroupChat(prisma, mgr(owner, companyA), {
        title: 'X',
        participantIds: [inactive],
      })
    ).toEqual({ ok: false, error: 'target_not_found' });
    expect(
      await createGroupChat(prisma, mgr(owner, companyA), {
        title: 'X',
        participantIds: ['нет-такого'],
      })
    ).toEqual({ ok: false, error: 'target_not_found' });
  });

  it('пустое или длинное название, никого не позвали, слишком много — отказ формы', async () => {
    const s = mgr(owner, companyA);
    expect(await createGroupChat(prisma, s, { title: '  ', participantIds: [member] })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(
      await createGroupChat(prisma, s, { title: 'я'.repeat(81), participantIds: [member] })
    ).toEqual({ ok: false, error: 'validation' });
    expect(await createGroupChat(prisma, s, { title: 'X', participantIds: [owner] })).toEqual({
      ok: false,
      error: 'validation',
    });
    const many = Array.from({ length: 51 }, (_, i) => `u${i}`);
    expect(await createGroupChat(prisma, s, { title: 'X', participantIds: many })).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('клиентская роль и сотрудник без компании — отказ', async () => {
    for (const s of [
      mgr(owner, companyA, 'organization'),
      mgr(owner, companyA, 'partner'),
      { sub: owner, role: 'manager', companyId: null } as never,
    ]) {
      expect(await createGroupChat(prisma, s, { title: 'X', participantIds: [member] })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
  });

  it('без названия в базе (старые данные) — в списке «Чат»', async () => {
    const bare = await prisma.staffConversation.create({
      data: {
        companyId: companyA,
        kind: 'group',
        participants: { create: [{ userId: owner }, { userId: member }] },
      },
      select: { id: true },
    });
    const list = await listConversations(prisma, mgr(owner, companyA));
    expect(list.rows.find((r) => r.id === bare.id)?.title).toBe('Чат');
  });
});
