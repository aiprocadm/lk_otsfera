import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// Транспорты и очереди — не предмет этого теста: проверяется путь ДАННЫХ.
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: vi.fn() }) }));
vi.mock('@/lib/notifications/manager', async (orig) => {
  const actual = await orig<typeof import('@/lib/notifications/manager')>();
  return { ...actual, notifyManagersMessengerMessage: vi.fn(async () => undefined) };
});

import { listCabinetDialogs } from '@/lib/services/cabinetDialogs/list';
import { getCabinetDialog } from '@/lib/services/cabinetDialogs/get';
import { replyFromCabinet } from '@/lib/services/cabinetDialogs/reply';

/**
 * Интеграция `У-234` (живой Postgres): клиент видит свою переписку и **не
 * видит внутренних заметок**; сообщение из кабинета ложится в тот же диалог,
 * который ведёт менеджер.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
let companyId = '';
let orgId = '';
let clientUser = '';
let staffUser = '';
let alienUser = '';
let dialogId = '';
let alienDialogId = '';

const clientSession = (): SessionPayload =>
  ({
    sub: clientUser,
    role: 'organization',
    organizationId: orgId,
    organizationMemberships: [{ organizationId: orgId, roleInOrg: 'admin', isActive: true }],
    email: `cab-${STAMP}@x.local`,
    name: 'Клиент',
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({ data: { name: `cabCo-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `cabOrg-${STAMP}`, companyId } });
  orgId = org.id;
  const [client, staff, alien] = await Promise.all([
    prisma.user.create({
      data: { email: `cab-${STAMP}@x.local`, name: 'Клиент', role: 'organization' },
    }),
    prisma.user.create({
      data: { email: `cab-st-${STAMP}@x.local`, name: 'Менеджер', role: 'manager' },
    }),
    prisma.user.create({
      data: { email: `cab-al-${STAMP}@x.local`, name: 'Чужой', role: 'organization' },
    }),
  ]);
  clientUser = client.id;
  staffUser = staff.id;
  alienUser = alien.id;

  const dialog = await prisma.messengerDialog.create({
    data: {
      channel: 'cabinet',
      peerRef: clientUser,
      userId: clientUser,
      organizationId: orgId,
      companyId,
      lastMessageAt: new Date('2026-09-17T10:00:00Z'),
      lastMessagePreview: 'Внутренняя заметка',
      lastMessageDirection: 'note',
    },
  });
  dialogId = dialog.id;
  await prisma.messengerMessage.createMany({
    data: [
      {
        dialogId,
        direction: 'in',
        body: `Вопрос клиента ${STAMP}`,
        createdAt: new Date('2026-09-17T08:00:00Z'),
      },
      {
        dialogId,
        direction: 'out',
        body: `Ответ менеджера ${STAMP}`,
        authorId: staffUser,
        createdAt: new Date('2026-09-17T09:00:00Z'),
      },
      {
        dialogId,
        direction: 'note',
        body: `СЕКРЕТНАЯ ЗАМЕТКА ${STAMP}`,
        authorId: staffUser,
        createdAt: new Date('2026-09-17T10:00:00Z'),
      },
    ],
  });

  const alienDialog = await prisma.messengerDialog.create({
    data: { channel: 'cabinet', peerRef: alienUser, userId: alienUser, companyId },
  });
  alienDialogId = alienDialog.id;
});

afterAll(async () => {
  await prisma.messengerMessage.deleteMany({
    where: { dialogId: { in: [dialogId, alienDialogId] } },
  });
  await prisma.messengerDialog.deleteMany({ where: { id: { in: [dialogId, alienDialogId] } } });
  await prisma.inboundMessage.deleteMany({ where: { senderRef: clientUser } });
  await prisma.auditLog.deleteMany({ where: { userId: clientUser } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientUser, staffUser, alienUser] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('переписка клиента с менеджером (У-234)', () => {
  it('в списке — своя переписка; чужая не видна, превью заметки скрыто', async () => {
    const rows = await listCabinetDialogs(prisma, clientSession());
    expect(rows.map((r) => r.id)).toContain(dialogId);
    expect(rows.map((r) => r.id)).not.toContain(alienDialogId);
    const own = rows.find((r) => r.id === dialogId)!;
    expect(own.preview).toBeNull();
    expect(own.isCabinet).toBe(true);
  });

  it('в ленте — две реплики из трёх: заметка сотрудников клиенту не видна', async () => {
    const res = await getCabinetDialog(prisma, clientSession(), dialogId);
    if (!res.ok) throw new Error('expected ok');
    const bodies = res.dialog.messages.map((m) => m.body);
    expect(bodies).toEqual([`Вопрос клиента ${STAMP}`, `Ответ менеджера ${STAMP}`]);
    expect(bodies.join(' ')).not.toContain('СЕКРЕТНАЯ');
    expect(res.dialog.hiddenCount).toBe(0);
  });

  it('чужая переписка по прямой ссылке — «не найдено»', async () => {
    expect(await getCabinetDialog(prisma, clientSession(), alienDialogId)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('сообщение из кабинета ложится в ТОТ ЖЕ диалог и попадает во «Входящие в работу»', async () => {
    const before = await prisma.messengerMessage.count({ where: { dialogId } });
    expect(await replyFromCabinet(prisma, clientSession(), `Новое сообщение ${STAMP}`)).toEqual({
      ok: true,
    });

    const after = await prisma.messengerMessage.count({ where: { dialogId } });
    expect(after).toBe(before + 1);
    const res = await getCabinetDialog(prisma, clientSession(), dialogId);
    if (!res.ok) throw new Error('expected ok');
    expect(res.dialog.messages.at(-1)?.body).toBe(`Новое сообщение ${STAMP}`);
    expect(res.dialog.messages.at(-1)?.direction).toBe('in');

    // Тот же путь, что у «Задать вопрос»: строка «Входящих» на месте.
    const inbound = await prisma.inboundMessage.findFirst({
      where: { senderRef: clientUser, body: `Новое сообщение ${STAMP}` },
      select: { channel: true, resolvedUserId: true, subject: true },
    });
    expect(inbound).toMatchObject({
      channel: 'cabinet',
      resolvedUserId: clientUser,
      subject: 'Сообщение из кабинета',
    });
  });
});
