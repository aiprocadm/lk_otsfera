import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/**
 * Окно выборки напоминаний об удостоверениях — московские дни (прогон
 * сопровождения №36, `Р-М-3`).
 *
 * Было `validUntil: { gte: today, lte: today + 90 дн. }` от МОМЕНТА прогона.
 * Прогон по расписанию — 07:00 МСК (04:00 UTC), а срок из формы хранится
 * полуночью UTC (03:00 МСК): в свой последний день удостоверение «уже прошло»
 * по `gte` и из выборки выпадало, хотя значок реестра писал «Истекает через
 * 0 дн.». Мок базы здесь честно применяет условие `where` к срокам — иначе
 * проверка окна ничего бы не проверяла.
 */

const { recordNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));

import { runCertificateExpiry } from '@/worker/processors/certificate-expiry';

type Window = { not: null; gte?: Date; lt?: Date };

function certRow(id: string, validUntil: string) {
  return {
    id,
    organizationId: 'org-1',
    validUntil: new Date(validUntil),
    number: id,
    student: { name: 'Иван Петров' },
    reminders: [] as { thresholdDays: number }[],
  };
}

function db(rows: ReturnType<typeof certRow>[]) {
  const findMany = vi.fn(async ({ where }: { where: { validUntil: Window } }) => {
    const { gte, lt } = where.validUntil;
    return rows.filter(
      (r) =>
        (!gte || r.validUntil.getTime() >= gte.getTime()) &&
        (!lt || r.validUntil.getTime() < lt.getTime())
    );
  });
  const reminderCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    certificate: { findMany },
    certificateReminder: { create: reminderCreate },
    organization: {
      findUnique: vi.fn().mockResolvedValue({
        partnerId: null,
        companyId: null,
        users: [{ id: 'u-org' }],
        partner: null,
      }),
    },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return { prisma, findMany, reminderCreate };
}

describe('runCertificateExpiry — окно по московским дням (прогон №36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
    deliverNotificationToUser.mockResolvedValue({});
  });

  it('окно — от 00:00 МСК сегодня до 00:00 МСК дня «сегодня + 91»', async () => {
    const { prisma, findMany } = db([]);
    await runCertificateExpiry(prisma, new Date('2026-09-30T04:00:00.000Z'));
    expect(findMany.mock.calls[0][0].where.validUntil).toEqual({
      not: null,
      gte: new Date('2026-09-29T21:00:00.000Z'),
      lt: new Date('2026-12-29T21:00:00.000Z'),
    });
  });

  it('последний день: срок 30.09 (полночь UTC), прогон 07:00 МСК 30.09 — напоминание уходит', async () => {
    const { prisma, reminderCreate } = db([certRow('LAST', '2026-09-30T00:00:00.000Z')]);
    const r = await runCertificateExpiry(prisma, new Date('2026-09-30T04:00:00.000Z'));
    expect(r.remindersSent).toBe(1);
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { certificateId: 'LAST', thresholdDays: 7 },
    });
    // Порог 7, а в тексте — правда: срок сегодня.
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ body: 'Удостоверение № LAST (Иван Петров) истекает сегодня' })
    );
  });

  it('текст — по настоящему остатку, а не по порогу: за 3 дня до срока «через 3 дн.»', async () => {
    // Удостоверение завели поздно: до конца срока 3 московских дня, порог
    // сработал 7-й. Раньше письмо обещало «через 7 дн.» (прогон №36).
    const { prisma, reminderCreate } = db([certRow('LATE', '2026-10-03T00:00:00.000Z')]);
    await runCertificateExpiry(prisma, new Date('2026-09-30T04:00:00.000Z'));
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { certificateId: 'LATE', thresholdDays: 7 },
    });
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ body: 'Удостоверение № LATE (Иван Петров) истекает через 3 дн.' })
    );
  });

  it('00:30 МСК 01.10: срок 30.09 истёк — вне окна; срок 01.10 — ещё в нём', async () => {
    const { prisma, reminderCreate } = db([
      certRow('EXPIRED', '2026-09-30T00:00:00.000Z'),
      certRow('TODAY', '2026-10-01T00:00:00.000Z'),
    ]);
    const r = await runCertificateExpiry(prisma, new Date('2026-09-30T21:30:00.000Z'));
    expect(r.remindersSent).toBe(1);
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { certificateId: 'TODAY', thresholdDays: 7 },
    });
  });

  it('дальний край: срок ровно через 90 московских дней — порог 90; через 91 — вне окна', async () => {
    const { prisma, reminderCreate } = db([
      certRow('D90', '2026-12-29T00:00:00.000Z'),
      certRow('D91', '2026-12-30T00:00:00.000Z'),
    ]);
    const r = await runCertificateExpiry(prisma, new Date('2026-09-30T04:00:00.000Z'));
    expect(r.remindersSent).toBe(1);
    expect(reminderCreate).toHaveBeenCalledWith({
      data: { certificateId: 'D90', thresholdDays: 90 },
    });
  });
});
