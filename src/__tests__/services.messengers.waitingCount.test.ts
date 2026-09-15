import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

vi.mock('@/lib/pii/record', () => ({ recordPiiAccess: vi.fn() }));

import { countWaitingDialogs } from '@/lib/services/messengers/list';
import { DIALOG_STATUS } from '@/lib/services/messengers/dialogStatus';

/**
 * Бейдж «Мессенджеры» (`У-215`) — счётчик ДЕЛ, а не сообщений.
 *
 * Прежний счётчик суммировал непрочитанные сообщения: цифра «7» читалась как
 * «семь дел», хотя означала «семь реплик», и отвеченный диалог продолжал
 * висеть в меню. Здесь проверяется сам смысл условия, а не его текст: условие
 * из `where` прогоняется по живым строкам маленьким разборщиком. Так тест
 * падает при изменении СМЫСЛА (например, если из условия уйдёт «не закрыт»), а
 * не при косметической перестановке скобок.
 */
const count = vi.fn();
const prisma = { messengerDialog: { count } } as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

type DialogRow = { companyId: string | null; status: string };

/**
 * Мини-разборщик `where`: понимает ровно те формы, которые строит счётчик —
 * `AND`, `OR`, равенство поля и `{ not: ... }`. Больше и не нужно: если в
 * условии появится что-то ещё, тест честно упадёт на «неизвестной форме».
 */
function matches(where: Prisma.MessengerDialogWhereInput, row: DialogRow): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND')
      return (value as Prisma.MessengerDialogWhereInput[]).every((w) => matches(w, row));
    if (key === 'OR')
      return (value as Prisma.MessengerDialogWhereInput[]).some((w) => matches(w, row));
    if (key !== 'companyId' && key !== 'status') {
      throw new Error(`условие счётчика изменилось: неизвестное поле ${key}`);
    }
    const actual = row[key];
    if (value !== null && typeof value === 'object') {
      const cond = value as { not?: unknown };
      if (!('not' in cond)) throw new Error(`неизвестная форма условия у поля ${key}`);
      return actual !== cond.not;
    }
    return actual === value;
  });
}

function whereOfLastCall(): Prisma.MessengerDialogWhereInput {
  const arg = count.mock.calls.at(-1)?.[0] as { where: Prisma.MessengerDialogWhereInput };
  return arg.where;
}

describe('countWaitingDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockResolvedValue(3);
  });

  it('возвращает число из базы одним запросом (по сообщениям не ходим)', async () => {
    await expect(countWaitingDialogs(prisma, session)).resolves.toBe(3);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('считает: ждёт ответа сотрудника ИЛИ ничей — и только незакрытые', async () => {
    await countWaitingDialogs(prisma, session);
    const where = whereOfLastCall();

    // Клиент написал, ответа нет — то самое состояние, из-за которого
    // руководителю прилетит просрочка SLA. Цифра меню и цифра эскалации
    // обязаны говорить об одном и том же.
    expect(matches(where, { companyId: 'c1', status: DIALOG_STATUS.waitingStaff })).toBe(true);
    // Ничей диалог — общая очередь: его не видит ни один ответственный, и
    // потерять его легче всего.
    expect(matches(where, { companyId: null, status: DIALOG_STATUS.open })).toBe(true);
    // Разобрались — значит, разобрались: закрытый ничейный НЕ висит в меню.
    // Это та самая ветка, ради которой в условии стоит «не закрыт».
    expect(matches(where, { companyId: null, status: DIALOG_STATUS.closed })).toBe(false);
    // Свой закрытый — тем более не дело.
    expect(matches(where, { companyId: 'c1', status: DIALOG_STATUS.closed })).toBe(false);
    // Ждём КЛИЕНТА — мяч не на нашей стороне, в меню такому делу не место.
    expect(matches(where, { companyId: 'c1', status: DIALOG_STATUS.waitingClient })).toBe(false);
    // Свой новый диалог, за который взялись, — тоже не «ждёт ответа».
    expect(matches(where, { companyId: 'c1', status: DIALOG_STATUS.open })).toBe(false);
  });

  it('граница компании держится: чужой диалог не попадает в счётчик', async () => {
    await countWaitingDialogs(prisma, session);
    const where = whereOfLastCall();
    expect(matches(where, { companyId: 'other', status: DIALOG_STATUS.waitingStaff })).toBe(false);
  });

  it('сессия без компании: видит только общую очередь, а не все компании сразу', async () => {
    await countWaitingDialogs(prisma, { ...session, companyId: null } as SessionPayload);
    const where = whereOfLastCall();
    // Часовой `__no_company__`: без него `companyId: undefined` снял бы фильтр
    // компании целиком и бейдж считал бы чужие диалоги.
    expect(matches(where, { companyId: null, status: DIALOG_STATUS.waitingStaff })).toBe(true);
    expect(matches(where, { companyId: 'c1', status: DIALOG_STATUS.waitingStaff })).toBe(false);
  });

  it('литералы статусов взяты из реестра, а не написаны руками', async () => {
    await countWaitingDialogs(prisma, session);
    // Опечатка в строке статуса типами не ловится: запрос просто ничего не
    // найдёт, молча. Поэтому сверяем условие с реестром `DIALOG_STATUS`.
    expect(JSON.stringify(whereOfLastCall())).toContain(`"not":"${DIALOG_STATUS.closed}"`);
    expect(JSON.stringify(whereOfLastCall())).toContain(`"status":"${DIALOG_STATUS.waitingStaff}"`);
  });
});
