import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { submitCabinetQuestion } = vi.hoisted(() => ({ submitCabinetQuestion: vi.fn() }));
vi.mock('@/lib/services/inbound/cabinetQuestion', () => ({ submitCabinetQuestion }));

import { listCabinetDialogs } from '@/lib/services/cabinetDialogs/list';
import { getCabinetDialog } from '@/lib/services/cabinetDialogs/get';
import { replyFromCabinet } from '@/lib/services/cabinetDialogs/reply';

/** «Переписка с менеджером» (`У-234`, `Р-Э6-1`): своя лента, без заметок, ответ — в диалог кабинета. */

const ORG = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'o1', roleInOrg: 'member', isActive: true }],
} as unknown as SessionPayload;
const PARTNER = { sub: 'u2', role: 'partner', partnerId: 'p1' } as unknown as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;

function db(over: Record<string, unknown> = {}) {
  const prisma = {
    messengerDialog: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    messengerMessage: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    ...over,
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

beforeEach(() => vi.clearAllMocks());

describe('listCabinetDialogs', () => {
  it('сотруднику — пусто без запроса; клиенту — свои диалоги, свежие сверху', async () => {
    const { prisma, raw } = db();
    expect(await listCabinetDialogs(prisma, MANAGER)).toEqual([]);
    expect(raw.messengerDialog.findMany).not.toHaveBeenCalled();

    raw.messengerDialog.findMany.mockResolvedValue([
      {
        id: 'd1',
        channel: 'cabinet',
        lastMessageAt: new Date('2026-09-17T10:00:00Z'),
        lastMessagePreview: 'Здравствуйте',
        lastMessageDirection: 'out',
      },
      {
        id: 'd2',
        channel: 'telegram',
        lastMessageAt: new Date('2026-09-16T10:00:00Z'),
        lastMessagePreview: 'Вопрос',
        lastMessageDirection: 'in',
      },
    ]);
    const rows = await listCabinetDialogs(prisma, ORG);
    expect(raw.messengerDialog.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1' },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    });
    expect(rows[0]).toMatchObject({
      id: 'd1',
      channelLabel: 'Кабинет',
      isCabinet: true,
      preview: 'Здравствуйте',
      lastDirection: 'out',
    });
    expect(rows[1]).toMatchObject({ id: 'd2', isCabinet: false, lastDirection: 'in' });
  });

  it('последняя реплика — внутренняя заметка: превью не показываем (У-209)', async () => {
    const { prisma, raw } = db();
    raw.messengerDialog.findMany.mockResolvedValue([
      {
        id: 'd1',
        channel: 'cabinet',
        lastMessageAt: new Date(),
        lastMessagePreview: 'Внутренняя заметка',
        lastMessageDirection: 'note',
      },
    ]);
    const rows = await listCabinetDialogs(prisma, PARTNER);
    expect(rows[0]).toMatchObject({ preview: null, lastDirection: null });
  });

  it('неизвестный канал не роняет список', async () => {
    const { prisma, raw } = db();
    raw.messengerDialog.findMany.mockResolvedValue([
      {
        id: 'd1',
        channel: 'carrier-pigeon',
        lastMessageAt: new Date(),
        lastMessagePreview: null,
        lastMessageDirection: null,
      },
    ]);
    const rows = await listCabinetDialogs(prisma, ORG);
    expect(rows[0]).toMatchObject({ channel: 'cabinet', isCabinet: true });
  });
});

describe('getCabinetDialog', () => {
  it('сотруднику и чужому диалогу — not_found', async () => {
    const { prisma, raw } = db();
    expect(await getCabinetDialog(prisma, MANAGER, 'd1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(raw.messengerDialog.findFirst).not.toHaveBeenCalled();
    expect(await getCabinetDialog(prisma, ORG, 'zz')).toEqual({ ok: false, error: 'not_found' });
    expect(raw.messengerDialog.findFirst.mock.calls[0][0].where).toEqual({
      id: 'zz',
      userId: 'u1',
    });
  });

  it('реплики только in/out, свежие снизу, скрытые посчитаны', async () => {
    const { prisma, raw } = db();
    raw.messengerDialog.findFirst.mockResolvedValue({ id: 'd1', channel: 'cabinet' });
    raw.messengerMessage.findMany.mockResolvedValue([
      {
        id: 'm2',
        direction: 'out',
        body: 'Ответ',
        createdAt: new Date('2026-09-17T11:00:00Z'),
        attachmentName: null,
      },
      {
        id: 'm1',
        direction: 'in',
        body: 'Вопрос',
        createdAt: new Date('2026-09-17T10:00:00Z'),
        attachmentName: 'file.pdf',
      },
    ]);
    raw.messengerMessage.count.mockResolvedValue(7);

    const res = await getCabinetDialog(prisma, ORG, 'd1');
    if (!res.ok) throw new Error('expected ok');
    // Фильтр направления — в ОБОИХ запросах: заметок клиент не видит никогда.
    expect(raw.messengerMessage.findMany.mock.calls[0][0].where).toEqual({
      dialogId: 'd1',
      direction: { in: ['in', 'out'] },
    });
    expect(raw.messengerMessage.count.mock.calls[0][0].where).toEqual({
      dialogId: 'd1',
      direction: { in: ['in', 'out'] },
    });
    expect(res.dialog.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(res.dialog.messages[0]).toMatchObject({ direction: 'in', attachmentName: 'file.pdf' });
    expect(res.dialog.hiddenCount).toBe(5);
    expect(res.dialog).toMatchObject({ channelLabel: 'Кабинет', isCabinet: true });
  });

  it('диалог мессенджера читается, но помечен как не-кабинет', async () => {
    const { prisma, raw } = db();
    raw.messengerDialog.findFirst.mockResolvedValue({ id: 'd2', channel: 'telegram' });
    const res = await getCabinetDialog(prisma, PARTNER, 'd2');
    if (!res.ok) throw new Error('expected ok');
    expect(res.dialog).toMatchObject({
      isCabinet: false,
      channelLabel: 'Telegram',
      hiddenCount: 0,
    });
  });

  it('неизвестный канал в карточке не роняет экран, а считается кабинетом', async () => {
    // У старой строки в базе может оказаться канал, которого реестр уже не
    // знает. Экран переписки из-за справочника падать не должен.
    const { prisma, raw } = db();
    raw.messengerDialog.findFirst.mockResolvedValue({ id: 'd3', channel: 'факс' });
    const res = await getCabinetDialog(prisma, PARTNER, 'd3');
    if (!res.ok) throw new Error('expected ok');
    expect(res.dialog).toMatchObject({ channel: 'cabinet', isCabinet: true });
  });
});

describe('replyFromCabinet', () => {
  it('пишет тем же путём, что «Задать вопрос», с темой переписки', async () => {
    const { prisma } = db();
    submitCabinetQuestion.mockResolvedValue({ ok: true, id: 'i1', code: 'ОБР-1' });
    expect(await replyFromCabinet(prisma, ORG, 'Здравствуйте')).toEqual({ ok: true });
    expect(submitCabinetQuestion).toHaveBeenCalledWith(prisma, ORG, {
      subject: 'Сообщение из кабинета',
      body: 'Здравствуйте',
    });
  });

  it('ошибки сервиса возвращаются как есть, с текстами проверки', async () => {
    const { prisma } = db();
    submitCabinetQuestion.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Опишите вопрос'],
    });
    expect(await replyFromCabinet(prisma, ORG, ' ')).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Опишите вопрос'],
    });
    submitCabinetQuestion.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await replyFromCabinet(prisma, MANAGER, 'x')).toEqual({ ok: false, error: 'forbidden' });
  });
});
