import { describe, it, expect } from 'vitest';
import {
  DIALOG_STATUS,
  DIALOG_STATUSES,
  dialogOverdueLevel,
  isDialogStatus,
  nextStatusOnInbound,
  nextStatusOnOutbound,
  waitingSinceFor,
} from '@/lib/services/messengers/dialogStatus';

/**
 * Автомат статусов диалога (`У-207`, спека этапа 3 §3.2) — чистый модуль,
 * поэтому моков здесь нет вовсе. Проверяется таблица переходов целиком,
 * отсчёт ожидания `waitingSince` и подсветка просрочки.
 */

const H = 3_600_000;
const NOW = new Date('2026-09-14T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);
const SLA = { responseHours: 8, warningHours: 4 };

describe('состав словаря статусов', () => {
  it('ровно четыре значения и они же в именованной карте', () => {
    expect([...DIALOG_STATUSES]).toEqual(['open', 'waiting_staff', 'waiting_client', 'closed']);
    expect(DIALOG_STATUS).toEqual({
      open: 'open',
      waitingStaff: 'waiting_staff',
      waitingClient: 'waiting_client',
      closed: 'closed',
    });
    // Карта нужна запросам к базе: там статус — обычная строка, и опечатка
    // молча ничего не найдёт. Поэтому значения карты обязаны быть из словаря.
    expect(Object.values(DIALOG_STATUS).every(isDialogStatus)).toBe(true);
  });

  it('isDialogStatus узнаёт свои значения и отвергает чужие', () => {
    for (const s of DIALOG_STATUSES) expect(isDialogStatus(s)).toBe(true);
    expect(isDialogStatus('waiting')).toBe(false);
    expect(isDialogStatus('Waiting_Staff')).toBe(false);
    expect(isDialogStatus('')).toBe(false);
    expect(isDialogStatus('note')).toBe(false);
  });
});

describe('переходы автомата', () => {
  it('входящее от клиента всегда ставит «ждёт ответа» — в том числе из закрытого', () => {
    // Р-М-1: новое обращение переоткрывает диалог. Прежнее состояние автомату
    // не передаётся вовсе — значит «из закрытого» разобрано тем же ответом.
    expect(nextStatusOnInbound()).toBe(DIALOG_STATUS.waitingStaff);
    expect(nextStatusOnInbound()).toBe('waiting_staff');
    expect(nextStatusOnInbound.length).toBe(0);
  });

  it('ответ сотрудника всегда ставит «ждём клиента» — в том числе из закрытого', () => {
    expect(nextStatusOnOutbound()).toBe(DIALOG_STATUS.waitingClient);
    expect(nextStatusOnOutbound()).toBe('waiting_client');
    expect(nextStatusOnOutbound.length).toBe(0);
  });

  it('у заметки перехода нет: событий у автомата ровно два — входящее и ответ', async () => {
    // Требование §3.2: внутреннее обсуждение не должно снимать диалог с
    // контроля SLA. Доказывается не текстом файла (комментарий обманул бы
    // проверку), а составом самого модуля: функции «статус после заметки»
    // в нём не существует, а обе существующие возвращают клиентские статусы.
    const mod = await import('@/lib/services/messengers/dialogStatus');
    const transitions = Object.entries(mod)
      .filter(([name, value]) => typeof value === 'function' && name.startsWith('nextStatusOn'))
      .map(([name]) => name)
      .sort();
    expect(transitions).toEqual(['nextStatusOnInbound', 'nextStatusOnOutbound']);
    expect(Object.keys(mod).filter((name) => /note/i.test(name))).toEqual([]);
    // И ни один из двух переходов не умеет вернуть «как было» — значит
    // заметке в автомате просто нечего позвать.
    expect([nextStatusOnInbound(), nextStatusOnOutbound()]).toEqual([
      'waiting_staff',
      'waiting_client',
    ]);
  });
});

describe('waitingSinceFor', () => {
  it('вход в «ждёт ответа» без отсчёта — отсчёт начинается сейчас', () => {
    expect(waitingSinceFor('waiting_staff', null, NOW)).toBe(NOW);
  });

  it('отсчёт уже идёт — не сдвигается: клиент ждёт с ПЕРВОГО сообщения', () => {
    const started = ago(5);
    expect(waitingSinceFor('waiting_staff', started, NOW)).toBe(started);
  });

  it('выход из «ждёт ответа» в любой другой статус сбрасывает отсчёт', () => {
    const started = ago(5);
    for (const s of ['open', 'waiting_client', 'closed'] as const) {
      expect(waitingSinceFor(s, started, NOW)).toBeNull();
      expect(waitingSinceFor(s, null, NOW)).toBeNull();
    }
  });
});

describe('dialogOverdueLevel', () => {
  it('не ждёт сотрудника — просрочки нет, даже если отсчёт остался от прошлого ожидания', () => {
    const stale = { waitingSince: ago(100) };
    for (const status of ['open', 'waiting_client', 'closed'] as const) {
      expect(dialogOverdueLevel({ status, ...stale }, SLA, NOW)).toBe('none');
    }
  });

  it('ждёт сотрудника, но отсчёта нет — считать нечего', () => {
    expect(dialogOverdueLevel({ status: 'waiting_staff', waitingSince: null }, SLA, NOW)).toBe(
      'none'
    );
  });

  it('три ступени: свежий → none, за порогом предупреждения → warning, за порогом SLA → overdue', () => {
    const level = (hours: number) =>
      dialogOverdueLevel({ status: 'waiting_staff', waitingSince: ago(hours) }, SLA, NOW);
    expect(level(1)).toBe('none');
    expect(level(3.9)).toBe('none');
    // Порог предупреждения включителен: ровно 4 часа — это уже предупреждение.
    expect(level(4)).toBe('warning');
    expect(level(7.9)).toBe('warning');
    // А порог SLA — строгий, ровно так же считает эскалация
    // (`ageHours <= threshold` она пропускает). Иначе на границе диалог горел
    // бы красным, а руководителю ничего не приходило.
    expect(level(8)).toBe('warning');
    expect(level(8.1)).toBe('overdue');
    expect(level(48)).toBe('overdue');
  });

  it('ожидание в будущем (часы сервера разъехались) не красит диалог', () => {
    const future = new Date(NOW.getTime() + 2 * H);
    expect(dialogOverdueLevel({ status: 'waiting_staff', waitingSince: future }, SLA, NOW)).toBe(
      'none'
    );
  });
});
