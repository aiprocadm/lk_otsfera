import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  recordNotification: vi.fn().mockResolvedValue({ row: { id: 'n1' }, deduped: false }),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import { runTaskOverdue } from '@/worker/processors/sla-escalation';

/**
 * СТРАЖ `У-225`: просроченная задача напоминает о себе ДВАЖДЫ и в разные дни —
 * исполнителю сразу, руководителю на N-й день, — и каждое напоминание ровно
 * один раз.
 *
 * Почему два поля, а не одно. Одно поле умеет сказать только «уже уведомляли»;
 * два разных повода в разные дни им не выражаются. Считать «который раз» по
 * датам на каждом прогоне — значит читать всю таблицу задач, ровно то, от чего
 * уходили в прогоне сопровождения №26.
 *
 * Почему claim атомарный. Ночной прогон может пойти дважды (ретрай очереди,
 * перезапуск воркера). `updateMany` по `null` возвращает 0, если строку уже
 * занял параллельный проход, — и тогда второе письмо не уходит. Проверка
 * «сначала прочитали, потом записали» такой гонки не выдержала бы.
 *
 * Мутация (проверено 15.09.2026): склеить два поля в одно (эскалация пишет и
 * проверяет `overdueNotifiedAt`) → руководитель перестаёт получать напоминание,
 * тест краснеет.
 */

const companyFindMany = vi.fn();
const taskFindMany = vi.fn();
const taskUpdateMany = vi.fn();

const prisma = {
  company: { findMany: companyFindMany },
  task: { findMany: taskFindMany, updateMany: taskUpdateMany },
} as unknown as PrismaClient;

const NOW = new Date('2026-09-15T09:00:00Z');

const COMPANY = {
  id: 'co-1',
  slaResponseHours: 24,
  taskOverdueEscalationDays: 3,
  users: [{ id: 'boss' }],
};

const TASK = {
  id: 't1',
  title: 'Проверить документы',
  dueDate: new Date('2026-09-10T09:00:00Z'),
  createdById: 'creator',
  assignees: [{ userId: 'worker' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  companyFindMany.mockResolvedValue([COMPANY]);
  taskUpdateMany.mockResolvedValue({ count: 1 });
  // `mockReset`, а не только `clearAllMocks`: очередь `mockResolvedValueOnce`
  // переживает очистку истории вызовов. Тест, у которого второй ответ не был
  // израсходован (эскалация не запускалась), отдавал свой остаток СЛЕДУЮЩЕМУ
  // тесту — и тот молча получал чужие данные.
  taskFindMany.mockReset();
  taskFindMany.mockResolvedValue([]);
});

/** Первый вызов findMany — исполнителям, второй — эскалация руководителю. */
function tasks(forAssignees: unknown[], forLeaders: unknown[]) {
  let call = 0;
  taskFindMany.mockImplementation(() => Promise.resolve(call++ === 0 ? forAssignees : forLeaders));
}

describe('страж: просрочка напоминает дважды и в разные дни', () => {
  it('исполнителю — в день просрочки, по своему полю-claim', async () => {
    tasks([TASK], []);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(1);

    // Выборка ищет незакрытые просроченные с ПУСТЫМ полем первого напоминания.
    const where = taskFindMany.mock.calls[0][0].where;
    expect(where.overdueNotifiedAt).toBeNull();
    expect(where.status).toEqual({ not: 'done' });
    // Claim — атомарный: условие повторяет `null`, а не полагается на выборку.
    expect(taskUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: 't1', overdueNotifiedAt: null },
      data: { overdueNotifiedAt: NOW },
    });
    expect(recordNotification.mock.calls[0][1].userId).toBe('worker');
    expect(recordNotification.mock.calls[0][1].type).toBe('task_overdue');
  });

  it('РУКОВОДИТЕЛЮ — на N-й день, по ДРУГОМУ полю-claim', async () => {
    tasks([], [{ id: 't1', title: 'Проверить документы', dueDate: TASK.dueDate }]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(1);

    const where = taskFindMany.mock.calls[1][0].where;
    // Поле ДРУГОЕ — иначе второе напоминание никогда бы не ушло.
    expect(where.overdueEscalatedAt).toBeNull();
    // И порог другой: не «просрочена», а «идёт третий день просрочки». Прогон
    // сопровождения №36 (`Р-М-3`): дни — московские. NOW = 15.09 12:00 МСК,
    // третий день просрочки у сроков по 12.09 включительно → граница 13.09
    // 00:00 МСК. Прежняя проверка «NOW минус трое суток» закрепляла отсчёт от
    // 03:00 МСК дня срока.
    expect(where.dueDate).toEqual({ lt: new Date('2026-09-13T00:00:00+03:00') });
    expect(taskUpdateMany.mock.calls[0][0].data).toEqual({ overdueEscalatedAt: NOW });
    expect(recordNotification.mock.calls[0][1].userId).toBe('boss');
  });

  it('ПОВТОРНЫЙ прогон ничего не шлёт: claim занят параллельным проходом', async () => {
    tasks([TASK], []);
    taskUpdateMany.mockResolvedValue({ count: 0 });
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(0);
    expect(recordNotification).not.toHaveBeenCalled();
  });

  it('задача без исполнителей напоминает СОЗДАТЕЛЮ, а не молчит', async () => {
    tasks([{ ...TASK, assignees: [] }], []);
    await runTaskOverdue(prisma, NOW);
    expect(recordNotification.mock.calls[0][1].userId).toBe('creator');
  });

  it('порог 0 — компания выключила эскалацию: руководителя не тревожим', async () => {
    companyFindMany.mockResolvedValue([{ ...COMPANY, taskOverdueEscalationDays: 0 }]);
    tasks([], [TASK]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(0);
    // Второй выборки не было вовсе — лишний запрос к базе тоже цена.
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('в компании нет руководителей — эскалация не запускается', async () => {
    companyFindMany.mockResolvedValue([{ ...COMPANY, users: [] }]);
    tasks([], [TASK]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(0);
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('сбой доставки одному получателю не отменяет claim и не роняет прогон', async () => {
    tasks([{ ...TASK, assignees: [{ userId: 'a' }, { userId: 'b' }] }], []);
    recordNotification.mockRejectedValueOnce(new Error('почта легла'));
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(1);
    expect(logError).toHaveBeenCalled();
    // Второму получателю письмо всё равно ушло.
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  });

  it('повтор за час (deduped: true) — строка «×N», доставка не зовётся, claim засчитан', async () => {
    tasks([TASK], []);
    recordNotification.mockResolvedValueOnce({ row: { id: 'n1' }, deduped: true });
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(1);
    // Ключ дедупа — задача; адреса кабинета в строке нет (`У-232`).
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'task_overdue', meta: { taskId: 't1' }, entityId: 't1' })
    );
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('обе половины считаются независимо и обе попадают в итог', async () => {
    tasks([TASK], [{ id: 't2', title: 'Старая', dueDate: TASK.dueDate }]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res).toEqual({ notified: 1, escalated: 1 });
  });
});

/**
 * Прогон сопровождения №36 (`Р-М-3`): «в день просрочки» и «на N-й день» —
 * московские дни. Сроки — такие, какие пишут настоящие писатели: форма задачи
 * (`new Date(<input type="date">)`, полночь UTC) и адаптер Битрикс24
 * (`new Date('…T01:30:00+03:00')` — 22:30 UTC накануне).
 */
describe('просрочка — по московскому дню срока (прогон №36)', () => {
  /** Попал бы срок в выборку исполнителю (0) или руководителю (1) в момент `now`. */
  async function pickedAt(now: Date, which: 0 | 1): Promise<(due: Date) => boolean> {
    tasks([], []);
    await runTaskOverdue(prisma, now);
    const { lt } = taskFindMany.mock.calls[which][0].where.dueDate as { lt: Date };
    taskFindMany.mockClear();
    return (due) => due < lt;
  }

  it('исполнителю — не в сам день срока, а с 00:00 МСК следующего', async () => {
    const FORM_DUE = new Date('2026-09-15');
    // 15.09 в 23:30 МСК — срок «15.09» ещё идёт (прежнее «< now» будило
    // исполнителя в 03:00 МСК того же дня: прогон идёт каждые 30 минут).
    expect((await pickedAt(new Date('2026-09-15T23:30:00+03:00'), 0))(FORM_DUE)).toBe(false);
    // 16.09 00:30 МСК — сервер (UTC) ещё в 15.09, но московский день кончился.
    expect((await pickedAt(new Date('2026-09-16T00:30:00+03:00'), 0))(FORM_DUE)).toBe(true);
    // Срок из Битрикс24 «16.09 01:30 МСК» в 02:00 МСК 16.09 — час прошёл,
    // день ещё нет: не просрочен.
    const BITRIX_DUE = new Date('2026-09-16T01:30:00+03:00');
    expect((await pickedAt(new Date('2026-09-16T02:00:00+03:00'), 0))(BITRIX_DUE)).toBe(false);
    expect((await pickedAt(new Date('2026-09-17T00:00:00+03:00'), 0))(BITRIX_DUE)).toBe(true);
  });

  it('руководителю — на 3-й московский день просрочки, с его 00:00', async () => {
    // Срок «10.09» из формы: просрочка 11, 12, 13.09 → письмо 13.09 с 00:00 МСК
    // (прежний отсчёт «now − 3 суток» ждал до 03:00 МСК).
    const FORM_DUE = new Date('2026-09-10');
    expect((await pickedAt(new Date('2026-09-12T23:59:00+03:00'), 1))(FORM_DUE)).toBe(false);
    expect((await pickedAt(new Date('2026-09-13T00:30:00+03:00'), 1))(FORM_DUE)).toBe(true);
    // Срок из Битрикс24 «11.09 01:30 МСК» (10.09 22:30 UTC) — его день 11.09,
    // третий день просрочки — 14.09.
    const BITRIX_DUE = new Date('2026-09-11T01:30:00+03:00');
    expect((await pickedAt(new Date('2026-09-13T23:30:00+03:00'), 1))(BITRIX_DUE)).toBe(false);
    expect((await pickedAt(new Date('2026-09-14T00:30:00+03:00'), 1))(BITRIX_DUE)).toBe(true);
  });

  it('дата в письме — по Москве: срок Битрикс24 01:30 МСК не «съезжает» на вчера', async () => {
    const BITRIX_DUE = new Date('2026-09-11T01:30:00+03:00');
    tasks([{ ...TASK, dueDate: BITRIX_DUE }], [{ id: 't2', title: 'Старая', dueDate: BITRIX_DUE }]);
    await runTaskOverdue(prisma, NOW);
    expect(recordNotification.mock.calls[0][1].body).toBe(
      '«Проверить документы»: срок был 11.09.2026.'
    );
    expect(recordNotification.mock.calls[1][1].body).toBe(
      '«Старая»: срок был 11.09.2026, прошло больше 3 дн.'
    );
  });
});

describe('краевые случаи напоминаний о просрочке', () => {
  it('ПОВТОРНАЯ эскалация не уходит: claim руководителя тоже занят', async () => {
    tasks([], [{ id: 't1', title: 'Старая', dueDate: TASK.dueDate }]);
    taskUpdateMany.mockResolvedValue({ count: 0 });
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(0);
    expect(recordNotification).not.toHaveBeenCalled();
  });

  it('задача без срока не печатает пустое место вместо даты', async () => {
    // В выборку такая задача попасть не должна, но текст письма собирается
    // ДО неё: пустая строка вместо даты выглядела бы как поломка письма.
    tasks([{ ...TASK, dueDate: null }], []);
    await runTaskOverdue(prisma, NOW);
    expect(recordNotification.mock.calls[0][1].body).toContain('—');
  });

  it('эскалация без срока — то же правило', async () => {
    tasks([], [{ id: 't1', title: 'Старая', dueDate: null }]);
    await runTaskOverdue(prisma, NOW);
    expect(recordNotification.mock.calls[0][1].body).toContain('—');
  });
});
