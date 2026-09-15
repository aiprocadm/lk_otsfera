import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getChannelHealth } from '@/lib/services/messengers/channelHealth';

/**
 * Светофор каналов переписки (`У-213`, этап 3 PR-7).
 *
 * Отвечает на два вопроса, которые администратор задаёт, когда «мессенджеры не
 * работают»: приходит ли к нам хоть что-то (последнее входящее) и уходит ли от
 * нас (последняя ошибка отправки). До этого ответа на них не было нигде:
 * причина отказа не сохранялась вовсе, и разбирательство сводилось к чтению
 * логов сервера.
 */
const findFirst = vi.fn();
const prisma = { messengerMessage: { findFirst } } as unknown as PrismaClient;

const leader = { sub: 'l1', role: 'leader', companyId: 'co-1' } as SessionPayload;
const admin = { sub: 'a1', role: 'admin', companyId: null } as unknown as SessionPayload;

const IN_AT = new Date('2026-09-14T08:00:00Z');
const FAIL_AT = new Date('2026-09-15T09:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
});

/** Ответы базы по порядку вызовов: для каждого канала сначала «входящее», потом «ошибка». */
function answer(perChannel: Array<[unknown, unknown]>) {
  const queue = perChannel.flat();
  findFirst.mockImplementation(() => Promise.resolve(queue.shift() ?? null));
}

describe('getChannelHealth — кому видно', () => {
  it.each(['manager', 'partner', 'organization', 'student'] as const)(
    'роль %s → forbidden, база не спрашивается',
    async (role) => {
      const r = await getChannelHealth(prisma, { ...leader, role } as unknown as SessionPayload);
      expect(r).toEqual({ ok: false, error: 'forbidden' });
      expect(findFirst).not.toHaveBeenCalled();
    }
  );

  it('руководителю видно: здесь только время и текст ошибки, ПДн и ключей нет', async () => {
    const r = await getChannelHealth(prisma, leader);
    expect(r.ok).toBe(true);
  });

  it('администратору видно', async () => {
    const r = await getChannelHealth(prisma, admin);
    expect(r.ok).toBe(true);
  });

  it('руководитель без компании получает пустой светофор, а не чужие цифры', async () => {
    // Своей переписки у такой сессии нет; снять фильтр компании значило бы
    // показать ей всё подряд.
    const r = await getChannelHealth(prisma, { ...leader, companyId: null } as SessionPayload);
    expect(r).toEqual({ ok: true, rows: [] });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('getChannelHealth — что считает', () => {
  it('строка на КАЖДЫЙ канал диалога, в одном и том же порядке', async () => {
    const r = await getChannelHealth(prisma, leader);
    // Почта и кабинет здесь не для полноты списка: причина отказа пишется и у
    // них, и без строки в светофоре «не доставлено» по почте было бы видно
    // только в одной ленте диалога — то есть почти никому.
    expect(r.ok && r.rows.map((x) => x.channel)).toEqual([
      'telegram',
      'max',
      'whatsapp',
      'email',
      'cabinet',
    ]);
  });

  it('канал без переписки: «не приходило» и «ошибок не было» — оба пустые', async () => {
    const r = await getChannelHealth(prisma, leader);
    expect(r.ok && r.rows[0]).toEqual({
      channel: 'telegram',
      lastInboundAt: null,
      lastErrorAt: null,
      lastError: null,
    });
  });

  it('берёт последнее входящее и последнюю неудачную отправку по каждому каналу', async () => {
    answer([
      [{ createdAt: IN_AT }, { createdAt: FAIL_AT, deliveryError: 'Клиент заблокировал бота' }],
      [null, null],
      [{ createdAt: IN_AT }, null],
      // Почта: ответ не ушёл — ровно тот случай, ради которого светофор
      // перестал ограничиваться ботами.
      [null, { createdAt: FAIL_AT, deliveryError: 'Почта не приняла письмо' }],
      [null, null],
    ]);
    const r = await getChannelHealth(prisma, leader);
    expect(r.ok && r.rows).toEqual([
      {
        channel: 'telegram',
        lastInboundAt: IN_AT,
        lastErrorAt: FAIL_AT,
        lastError: 'Клиент заблокировал бота',
      },
      { channel: 'max', lastInboundAt: null, lastErrorAt: null, lastError: null },
      { channel: 'whatsapp', lastInboundAt: IN_AT, lastErrorAt: null, lastError: null },
      {
        channel: 'email',
        lastInboundAt: null,
        lastErrorAt: FAIL_AT,
        lastError: 'Почта не приняла письмо',
      },
      { channel: 'cabinet', lastInboundAt: null, lastErrorAt: null, lastError: null },
    ]);
  });

  it('ошибка без сохранённой причины показывает только время', async () => {
    answer([[null, { createdAt: FAIL_AT, deliveryError: null }]]);
    const r = await getChannelHealth(prisma, leader);
    expect(r.ok && r.rows[0]).toEqual({
      channel: 'telegram',
      lastInboundAt: null,
      lastErrorAt: FAIL_AT,
      lastError: null,
    });
  });
});

describe('getChannelHealth — границы выборки', () => {
  it('руководитель считает только переписку СВОЕЙ компании (C8)', async () => {
    await getChannelHealth(prisma, leader);
    // Десять запросов: пять каналов × (входящее + ошибка); у каждого — своя компания.
    expect(findFirst).toHaveBeenCalledTimes(10);
    for (const call of findFirst.mock.calls) {
      expect(call[0].where.dialog.companyId).toBe('co-1');
    }
  });

  it('последняя строка берётся именно последней по времени', async () => {
    await getChannelHealth(prisma, leader);
    for (const call of findFirst.mock.calls) {
      expect(call[0].orderBy).toEqual({ createdAt: 'desc' });
    }
  });

  it('входящее и ошибка ищутся по разным признакам — их нельзя перепутать', async () => {
    await getChannelHealth(prisma, leader);
    const [inbound, failure] = findFirst.mock.calls.map((c) => c[0].where);
    expect(inbound.direction).toBe('in');
    expect(failure).toMatchObject({ direction: 'out', deliveryStatus: 'failed' });
    expect(inbound.dialog.channel).toBe('telegram');
    expect(failure.dialog.channel).toBe('telegram');
  });

  it('администратор видит все компании — это Model A, а не дыра', async () => {
    await getChannelHealth(prisma, admin);
    for (const call of findFirst.mock.calls) {
      expect(call[0].where.dialog).not.toHaveProperty('companyId');
    }
  });

  it('у администратора с компанией фильтр всё равно не появляется', async () => {
    // Админ управляет всем через своё зеркало; сужение до «его» компании
    // сделало бы светофор молчащим ровно там, где он нужен.
    await getChannelHealth(prisma, { ...admin, companyId: 'co-1' } as SessionPayload);
    for (const call of findFirst.mock.calls) {
      expect(call[0].where.dialog).not.toHaveProperty('companyId');
    }
  });
});
