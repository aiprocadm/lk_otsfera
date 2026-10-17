import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setIntakeImportant } from '@/lib/services/intake/important';
import { listIntake, countIntake } from '@/lib/services/intake/list';

/**
 * «Важное» во «Входящих обращениях» против живой базы (этап 7 ТЗ 13.10.2026,
 * `У-318`, `Р-7-6`). Инварианты: пометка ставится и снимается с записью в
 * журнал; чужую компанию не пометить (ответ «не найдено», а не «запрещено» —
 * существование чужого письма не раскрываем); важное — первым в очереди и
 * попадает в отбор «Только важные»; вопрос из кабинета в очереди остаётся (ФТ-11.1).
 */
const prisma = new PrismaClient();
const S = `intImp${Date.now()}${Math.floor(Math.random() * 1e4)}`;
let companyA: string;
let companyB: string;
let manager: string;
let foreignMsg: string;
let oldMsg: string;
let newMsg: string;
let cabinetMsg: string;
let call: string;

const sess = () =>
  ({ sub: manager, role: 'manager', companyId: companyA, managedOrgIds: [] }) as never;

async function msg(companyId: string, hoursAgo: number, channel = 'telegram') {
  return (
    await prisma.inboundMessage.create({
      data: {
        channel,
        externalId: `${S}-${Math.random()}`,
        senderRef: `${S}-sender`,
        body: 'текст',
        companyId,
        createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
      },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  companyA = (await prisma.company.create({ data: { name: `${S}-A` } })).id;
  companyB = (await prisma.company.create({ data: { name: `${S}-B` } })).id;
  manager = (
    await prisma.user.create({
      data: { email: `${S}@x.local`, name: 'М', role: 'manager', companyId: companyA },
    })
  ).id;
  oldMsg = await msg(companyA, 10);
  newMsg = await msg(companyA, 1);
  cabinetMsg = await msg(companyA, 2, 'cabinet');
  foreignMsg = await msg(companyB, 1);
  // Неразобранное видят все (общая очередь разбора) — «чужим» письмо становится,
  // когда его разобрали за другой компанией.
  await prisma.inboundMessage.update({ where: { id: foreignMsg }, data: { status: 'bound' } });
  call = (
    await prisma.call.create({
      data: {
        externalId: `${S}-call`,
        direction: 'inbound',
        callerNumber: '+79990001122',
        status: 'missed',
        companyId: companyA,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: manager } });
  await prisma.piiAccessEvent.deleteMany({ where: { userId: manager } });
  await prisma.inboundMessage.deleteMany({ where: { senderRef: `${S}-sender` } });
  await prisma.call.deleteMany({ where: { id: call } });
  await prisma.user.deleteMany({ where: { id: manager } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('setIntakeImportant (`У-318`)', () => {
  it('сообщение: пометка ставится с автором и временем, пишется журнал', async () => {
    expect(
      await setIntakeImportant(prisma, sess(), { type: 'inbound', id: newMsg, important: true })
    ).toEqual({ ok: true });
    const row = await prisma.inboundMessage.findUniqueOrThrow({
      where: { id: newMsg },
      select: { importantAt: true, importantById: true },
    });
    expect(row.importantAt).toBeInstanceOf(Date);
    expect(row.importantById).toBe(manager);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: manager, entityId: newMsg },
      select: { action: true, entity: true },
    });
    expect(audit).toEqual({ action: 'intake_marked_important', entity: 'inbound_message' });
  });

  it('в очереди важное — первым и в отборе «Только важные»; вопрос из кабинета — на месте', async () => {
    const all = await listIntake(prisma, sess());
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const mine = all.result.items.filter((i) => [oldMsg, newMsg, cabinetMsg, call].includes(i.id));
    expect(mine[0]).toMatchObject({ id: newMsg, important: true });
    // ФТ-11.1: вопрос из кабинета остаётся в очереди.
    expect(mine.map((i) => i.id)).toContain(cabinetMsg);
    const onlyImportant = await listIntake(prisma, sess(), { onlyImportant: true });
    expect(onlyImportant.ok && onlyImportant.result.items.map((i) => i.id)).toContain(newMsg);
    expect(onlyImportant.ok && onlyImportant.result.items.map((i) => i.id)).not.toContain(oldMsg);
    // Фильтр «Из кабинета» — только вопросы из кабинета.
    const cabinet = await listIntake(prisma, sess(), { channel: 'cabinet' });
    expect(cabinet.ok && cabinet.result.items.map((i) => i.id)).toContain(cabinetMsg);
    expect(cabinet.ok && cabinet.result.items.map((i) => i.id)).not.toContain(newMsg);
    // Счётчик меню — те же правила, что у списка: разобранное уходит из счёта.
    const before = await countIntake(prisma, sess());
    await prisma.inboundMessage.update({ where: { id: cabinetMsg }, data: { status: 'bound' } });
    expect(await countIntake(prisma, sess())).toBe(before - 1);
    await prisma.inboundMessage.update({
      where: { id: cabinetMsg },
      data: { status: 'unresolved' },
    });
  });

  it('снятие пометки — поля пустые, журнал «снятие»', async () => {
    expect(
      await setIntakeImportant(prisma, sess(), { type: 'inbound', id: newMsg, important: false })
    ).toEqual({ ok: true });
    const row = await prisma.inboundMessage.findUniqueOrThrow({
      where: { id: newMsg },
      select: { importantAt: true, importantById: true },
    });
    expect(row).toEqual({ importantAt: null, importantById: null });
    expect(
      await prisma.auditLog.count({
        where: { userId: manager, entityId: newMsg, action: 'intake_unmarked_important' },
      })
    ).toBe(1);
  });

  it('звонок своей компании помечается; канал «Звонки» его показывает', async () => {
    expect(
      await setIntakeImportant(prisma, sess(), { type: 'call', id: call, important: true })
    ).toEqual({ ok: true });
    const calls = await listIntake(prisma, sess(), { channel: 'call', onlyImportant: true });
    expect(calls.ok && calls.result.items.map((i) => [i.id, i.channel])).toContainEqual([
      call,
      'call',
    ]);
  });

  it('чужая компания и несуществующая запись — «не найдено»; клиентская роль — отказ', async () => {
    expect(
      await setIntakeImportant(prisma, sess(), { type: 'inbound', id: foreignMsg, important: true })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await setIntakeImportant(prisma, sess(), { type: 'call', id: 'нет', important: true })
    ).toEqual({ ok: false, error: 'not_found' });
    const foreign = await prisma.inboundMessage.findUniqueOrThrow({
      where: { id: foreignMsg },
      select: { importantAt: true },
    });
    expect(foreign.importantAt).toBeNull();
    expect(
      await setIntakeImportant(
        prisma,
        { sub: manager, role: 'organization', companyId: companyA } as never,
        {
          type: 'inbound',
          id: newMsg,
          important: true,
        }
      )
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});
