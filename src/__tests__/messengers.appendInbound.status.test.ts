import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const m = vi.hoisted(() => ({
  upsertDialog: vi.fn(),
  notifyManagersMessengerMessage: vi.fn(),
}));
vi.mock('@/lib/services/messengers/dialog', () => ({
  upsertDialog: m.upsertDialog,
  previewOf: (text: string) => text.replace(/\s+/g, ' ').trim(),
}));
vi.mock('@/lib/notifications/manager', () => ({
  notifyManagersMessengerMessage: m.notifyManagersMessengerMessage,
}));

import { appendInboundToDialog } from '@/lib/services/messengers/appendInbound';
import { dialogOverdueLevel } from '@/lib/services/messengers/dialogStatus';

/**
 * Входящее из мессенджера в части статуса и адресата уведомления
 * (`У-206`, `У-207`) — на моках, без базы. Живая база проверяется отдельно
 * в `messengers.appendInbound.integration.test.ts`.
 */
const messageFindUnique = vi.fn();
const messageCreate = vi.fn();
const dialogUpdateMany = vi.fn();
const prisma = {
  messengerMessage: { findUnique: messageFindUnique, create: messageCreate },
  messengerDialog: { updateMany: dialogUpdateMany },
} as unknown as PrismaClient;

const AT = new Date('2026-09-14T09:00:00Z');
/** «Сейчас» для расчёта просрочки — сразу после времени письма. */
const NOW_ISH = new Date('2026-09-14T09:05:00Z');

/** Диалог, каким его вернул upsert: по умолчанию ничей и никем не ведётся. */
function dialog(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    companyId: 'c1',
    organizationId: null,
    peerDisplay: null,
    assigneeId: null,
    waitingSince: null,
    ...over,
  };
}

const ARGS = {
  inboundMessageId: 'in1',
  channel: 'telegram' as const,
  peerRef: 'chat-1',
  body: 'нужен счёт',
  externalId: 'ext-1',
  sentAt: AT,
  binding: null,
};

describe('appendInboundToDialog: статус и отсчёт ожидания', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageFindUnique.mockResolvedValue(null);
    messageCreate.mockResolvedValue({ id: 'mm1' });
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    m.upsertDialog.mockResolvedValue(dialog());
    m.notifyManagersMessengerMessage.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });

  it('входящее ставит «ждёт ответа» и в новом диалоге, и в существующем', async () => {
    await appendInboundToDialog(prisma, ARGS);
    const [, , args] = m.upsertDialog.mock.calls[0]!;
    expect(args.create).toMatchObject({ status: 'waiting_staff', waitingSince: AT });
    expect(args.update).toMatchObject({ status: 'waiting_staff' });
    // В `update` отсчёта нет намеренно: иначе каждое следующее сообщение
    // клиента обнуляло бы просрочку и диалог никогда бы не «покраснел».
    expect(Object.keys(args.update)).not.toContain('waitingSince');
  });

  it('отсчёт ещё не идёт → ставится, и условие «не идёт» продублировано в where', async () => {
    await appendInboundToDialog(prisma, ARGS);
    expect(dialogUpdateMany).toHaveBeenCalledWith({
      where: { id: 'd1', waitingSince: null },
      data: { waitingSince: AT },
    });
  });

  it('второе сообщение подряд отсчёт НЕ сдвигает: клиент ждёт с первого', async () => {
    const started = new Date('2026-09-14T08:00:00Z');
    m.upsertDialog.mockResolvedValueOnce(dialog({ waitingSince: started }));
    await appendInboundToDialog(prisma, ARGS);
    expect(dialogUpdateMany).not.toHaveBeenCalled();
  });

  it('время сообщения не пришло — отсчёт от момента записи', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog());
    await appendInboundToDialog(prisma, { ...ARGS, sentAt: null });
    const data = dialogUpdateMany.mock.calls[0]![0].data as { waitingSince: Date };
    expect(data.waitingSince).toBeInstanceOf(Date);
  });

  it('повторный вызов по тому же письму ничего не трогает', async () => {
    messageFindUnique.mockResolvedValueOnce({ id: 'mm0', dialogId: 'd1' });
    await expect(appendInboundToDialog(prisma, ARGS)).resolves.toEqual({
      ok: true,
      dialogId: 'd1',
      messageId: 'mm0',
      deduped: true,
    });
    expect(m.upsertDialog).not.toHaveBeenCalled();
    expect(dialogUpdateMany).not.toHaveBeenCalled();
    expect(m.notifyManagersMessengerMessage).not.toHaveBeenCalled();
  });
});

describe('appendInboundToDialog: кого уведомляем', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageFindUnique.mockResolvedValue(null);
    messageCreate.mockResolvedValue({ id: 'mm1' });
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    m.notifyManagersMessengerMessage.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });

  it('есть ответственный → уведомление уходит ему (организация при этом не важна)', async () => {
    m.upsertDialog.mockResolvedValueOnce(
      dialog({ assigneeId: 'u2', organizationId: 'org1', peerDisplay: 'Иван' })
    );
    await appendInboundToDialog(prisma, ARGS);
    expect(m.notifyManagersMessengerMessage).toHaveBeenCalledWith(prisma, {
      organizationId: 'org1',
      assigneeId: 'u2',
      dialogId: 'd1',
      peerLabel: 'Иван',
      channelLabel: 'Telegram',
      excerpt: 'нужен счёт',
    });
  });

  it('ответственного нет, но диалог привязан к организации → уведомляем менеджеров организации', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ organizationId: 'org1' }));
    await appendInboundToDialog(prisma, ARGS);
    expect(m.notifyManagersMessengerMessage).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ organizationId: 'org1', assigneeId: null, peerLabel: 'chat-1' })
    );
  });

  it('нет ни ответственного, ни организации → не дёргаем никого', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ organizationId: null, assigneeId: null }));
    await appendInboundToDialog(prisma, ARGS);
    expect(m.notifyManagersMessengerMessage).not.toHaveBeenCalled();
  });

  it('распознанный отправитель привязывает ничей диалог — уведомление уходит его организации', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ companyId: null, organizationId: null }));
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    await appendInboundToDialog(prisma, {
      ...ARGS,
      binding: { companyId: 'c1', organizationId: 'org7', contactId: null, userId: null },
    });
    expect(m.notifyManagersMessengerMessage).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ organizationId: 'org7' })
    );
  });

  it('диалог привязал кто-то другой (count 0) — организация остаётся прежней', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ companyId: null, organizationId: null }));
    dialogUpdateMany.mockResolvedValue({ count: 0 });
    await appendInboundToDialog(prisma, {
      ...ARGS,
      binding: { companyId: 'c1', organizationId: 'org7', contactId: null, userId: null },
    });
    expect(m.notifyManagersMessengerMessage).not.toHaveBeenCalled();
  });

  it('бэкфилл (markUnread:false) старые письма не рассылает', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ assigneeId: 'u2', organizationId: 'org1' }));
    await appendInboundToDialog(prisma, { ...ARGS, markUnread: false });
    expect(m.notifyManagersMessengerMessage).not.toHaveBeenCalled();
    // …и статуса не касается: свёртка старых писем не должна поднимать
    // ожидание задним числом (см. следующий тест).
    const [, , args] = m.upsertDialog.mock.calls[0]!;
    expect(args.update).not.toHaveProperty('status');
  });

  it('бэкфилл старого письма НЕ поднимает просрочку задним числом', () => {
    // Свёртка письма месячной давности не должна делать диалог «ждущим
    // ответа»: исходящих бэкфилл не сворачивает, снять такой статус нечем, и
    // первый же прогон эскалации завалил бы руководителей просрочками по
    // перепискам, на которые давно ответили. План PR-1: «данные не переносим,
    // автомат расставит статусы по первому же событию».
    const old = new Date(NOW_ISH.getTime() - 30 * 24 * 60 * 60 * 1000);
    m.upsertDialog.mockResolvedValueOnce(dialog({ organizationId: 'org1' }));
    return appendInboundToDialog(prisma, { ...ARGS, sentAt: old, markUnread: false }).then(() => {
      // Отсчёт ожидания не ставится ни в upsert, ни отдельной записью.
      const [, , args] = m.upsertDialog.mock.calls[0]!;
      expect(args.create).toMatchObject({ status: 'open', waitingSince: null });
      expect(dialogUpdateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ waitingSince: expect.anything() }),
        })
      );
      // И подсветка у такого диалога спокойная.
      expect(
        dialogOverdueLevel(
          { status: 'open', waitingSince: null },
          { responseHours: 24, warningHours: 4 },
          NOW_ISH
        )
      ).toBe('none');
    });
  });

  it('сбой уведомления не роняет реплику', async () => {
    m.upsertDialog.mockResolvedValueOnce(dialog({ assigneeId: 'u2' }));
    m.notifyManagersMessengerMessage.mockRejectedValueOnce(new Error('smtp down'));
    await expect(appendInboundToDialog(prisma, ARGS)).resolves.toMatchObject({
      ok: true,
      deduped: false,
    });
  });
});
