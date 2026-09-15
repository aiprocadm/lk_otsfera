import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { countWaitingDialogs, listDialogs } from '@/lib/services/messengers/list';
import { getDialog, markDialogRead } from '@/lib/services/messengers/get';
import { sendDialogMessage } from '@/lib/services/messengers/send';
import { setDialogStatus } from '@/lib/services/messengers/status';
import { bindDialog } from '@/lib/services/messengers/bind';

/**
 * Регресс изоляции компаний для диалогов мессенджеров (спека 2026-09-12,
 * Р-М-3; C8). Менеджер компании A видит диалоги своей компании и общую
 * очередь непривязанных — и никогда диалог компании B: ни в списке, ни в
 * карточке, ни через ответ, закрытие, привязку или счётчик.
 */
const prisma = new PrismaClient();
const STAMP = `idorMsgr${Date.now()}`;

let companyA = '';
let companyB = '';
let dialogA = '';
let dialogB = '';
let dialogFree = '';
let managerA: SessionPayload;
let managerB: SessionPayload;
/**
 * Ничейные незакрытые диалоги, заведённые НЕ этим тестом. База интеграционного
 * слоя общая, а общая очередь (`companyId IS NULL`) видна всем компаниям сразу
 * — поэтому точные ожидания счётчика строятся поверх этого фона.
 */
let freeNoise = 0;

beforeAll(async () => {
  const cA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
  const cB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
  companyA = cA.id;
  companyB = cB.id;
  // Статусы расставлены осмысленно: `У-215` считает ЖДУЩИЕ диалоги, поэтому
  // рядом со «ждёт ответа» заведены закрытый и «ждём клиента» — если счётчик
  // снова начнёт грести всё подряд, арифметика ниже разъедется.
  const [a, b, , free] = await Promise.all([
    prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: `${STAMP}-a`,
        companyId: companyA,
        status: 'waiting_staff',
        unreadCount: 2,
      },
    }),
    prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: `${STAMP}-b`,
        companyId: companyB,
        status: 'waiting_staff',
        unreadCount: 5,
      },
    }),
    // Второй ждущий диалог компании B — чтобы числа у A и B не совпали
    // случайно: совпадающие числа не доказали бы изоляцию.
    prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: `${STAMP}-b2`,
        companyId: companyB,
        status: 'waiting_staff',
      },
    }),
    prisma.messengerDialog.create({
      data: { channel: 'max', peerRef: `${STAMP}-free`, unreadCount: 1 },
    }),
    // Ждём клиента — мяч на его стороне, сотрудника этот диалог не ждёт.
    prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: `${STAMP}-a-answered`,
        companyId: companyA,
        status: 'waiting_client',
      },
    }),
    // Закрытые не ждут никого — ни свой, ни ничейный из общей очереди.
    prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: `${STAMP}-a-closed`,
        companyId: companyA,
        status: 'closed',
      },
    }),
    prisma.messengerDialog.create({
      data: { channel: 'max', peerRef: `${STAMP}-free-closed`, status: 'closed' },
    }),
  ]);
  dialogA = a.id;
  dialogB = b.id;
  dialogFree = free.id;
  freeNoise = await prisma.messengerDialog.count({
    where: {
      companyId: null,
      status: { not: 'closed' },
      peerRef: { not: { startsWith: STAMP } },
    },
  });
  managerA = {
    sub: `${STAMP}-mgr`,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
  } as unknown as SessionPayload;
  managerB = { ...managerA, sub: `${STAMP}-mgrB`, companyId: companyB } as SessionPayload;
});

afterAll(async () => {
  await prisma.messengerDialog.deleteMany({ where: { peerRef: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

describe('IDOR — диалоги мессенджеров не утекают между компаниями', () => {
  it('список и счётчик: своя компания + общая очередь, без чужой', async () => {
    const { items } = await listDialogs(prisma, managerA, { pageSize: 100 });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(dialogA);
    expect(ids).toContain(dialogFree);
    expect(ids).not.toContain(dialogB);

    // Общая очередь у обоих одна, а своё — разное: у A один ждущий диалог, у
    // B — два. Числа точные: фон чужих ничейных диалогов посчитан отдельно, а
    // всё остальное заведено этим тестом.
    const [waitingA, waitingB] = await Promise.all([
      countWaitingDialogs(prisma, managerA),
      countWaitingDialogs(prisma, managerB),
    ]);
    // A: ничейный `free` + свой `a`. Ни «ждём клиента», ни закрытые — свой и
    // ничейный — в счёт не идут, иначе здесь было бы на три больше.
    expect(waitingA).toBe(freeNoise + 2);
    // B: тот же ничейный + два своих. Диалоги компании A сюда не протекают —
    // иначе разница между числами не была бы ровно в одном диалоге.
    expect(waitingB).toBe(freeNoise + 3);
  });

  it('карточка чужого диалога — not_found, своего и ничьего — открывается', async () => {
    expect(await getDialog(prisma, managerA, dialogB)).toEqual({ ok: false, error: 'not_found' });
    expect((await getDialog(prisma, managerA, dialogA)).ok).toBe(true);
    expect((await getDialog(prisma, managerA, dialogFree)).ok).toBe(true);
  });

  it('прочтение чужого диалога не обнуляет его счётчик', async () => {
    await markDialogRead(prisma, managerA, dialogB);
    const b = await prisma.messengerDialog.findUnique({ where: { id: dialogB } });
    expect(b?.unreadCount).toBe(5);
    await markDialogRead(prisma, managerA, dialogA);
    const a = await prisma.messengerDialog.findUnique({ where: { id: dialogA } });
    expect(a?.unreadCount).toBe(0);
  });

  it('ответ, закрытие и привязка чужого диалога отвергаются до любого побочного эффекта', async () => {
    expect(await sendDialogMessage(prisma, managerA, { dialogId: dialogB, text: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      await setDialogStatus(prisma, managerA, { dialogId: dialogB, status: 'closed' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await bindDialog(prisma, managerA, { dialogId: dialogB, organizationId: 'whatever' })
    ).toEqual({ ok: false, error: 'forbidden' });
    const b = await prisma.messengerDialog.findUnique({
      where: { id: dialogB },
      include: { messages: true },
    });
    // Статус остался тем, что был при создании: закрытие чужого диалога не
    // прошло, а не «прошло и вернулось».
    expect(b).toMatchObject({ companyId: companyB, status: 'waiting_staff' });
    expect(b?.messages).toHaveLength(0);
  });
});
