import { describe, expect, it, vi } from 'vitest';
import { moscowCalendarDay, moscowDayRange } from '@/lib/dates/calendar';
import { startOfMoscowDay as moscowDayAsUtcMidnight } from '@/lib/documents/proposalExpiry';
import { fmtDate } from '@/lib/format';
import { FileBitrixSource } from '@/lib/services/bitrix/adapter-file';
import { RestBitrixSource } from '@/lib/services/bitrix/adapter-rest';
import type { BitrixClientOptions } from '@/lib/services/bitrix/client';
import { planDeal, type ExistingDeal } from '@/lib/services/bitrix/mapping/deals';
import type { TargetStage } from '@/lib/services/bitrix/mapping/stages';
import { planTask, type ExistingTask } from '@/lib/services/bitrix/mapping/tasks';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixDeal, BitrixTask } from '@/lib/services/bitrix/source';
import { dueByWhere, isPastDue, moscowDaysUntil, pastDueWhere } from '@/lib/tasks/due';

/**
 * Дата «только день» из Битрикс24 приходит двумя видами (прогон
 * сопровождения №37).
 *
 * REST отдаёт день закрытия сделки и крайний срок задачи полночью ПОРТАЛА:
 * `'2025-11-03T00:00:00+03:00'` — это момент `2025-11-02T21:00Z`. Выгрузка
 * файлом печатает тот же день как `03.11.2025`, и разбор ячейки делает из
 * него полночь UTC — `2025-11-03T00:00Z`. Колонок `@db.Date` в схеме нет, оба
 * значения ложатся в базу моментом времени, и между ними ровно три часа.
 *
 * Тест закрепляет, что эти три часа безвредны: вся логика дня в продукте
 * считает по московскому календарю, и оба вида попадают в один и тот же
 * московский день — на экране, в поле формы, в фильтре по дате, в просрочке и
 * в выборках «до конца дня». Повторный перенос из другого источника дату не
 * переписывает: план сделки и задачи сравнивает название, статус и
 * организацию, а не дату закрытия, — сделка с той же стадией пропускается
 * как «без изменений».
 */

const REST_MIDNIGHT = '2025-11-03T00:00:00+03:00';
/**
 * Так дату-день отдаёт ЖИВОЙ портал заказчика: проверено 23.09.2026 чтением
 * последних сделок (`CLOSEDATE`, `BEGINDATE` — `…T03:00:00+03:00`). 03:00 по
 * Москве — ровно полночь UTC, то есть тот же момент, что даёт файл. Вид
 * `REST_MIDNIGHT` выше оставлен как худший случай: даже он безвреден.
 */
const REST_PORTAL = '2025-11-03T03:00:00+03:00';
const FILE_DAY = '03.11.2025';
const DAY = '2025-11-03';

type Transport = NonNullable<BitrixClientOptions['transport']>;
const BASE = 'https://demo.bitrix24.ru/rest/1/secret-token/';

/** Источник REST на подставном транспорте: один метод — одна страница. */
function restSource(routes: Record<string, unknown[]>): RestBitrixSource {
  const transport = vi.fn<Transport>(async (url) => ({
    status: 200,
    body: { result: routes[url.slice(BASE.length)] ?? [], total: 1 },
  }));
  return new RestBitrixSource({
    webhookUrl: BASE,
    transport,
    now: () => 0,
    sleep: async () => {},
    retries: 0,
  });
}

const BOM = String.fromCharCode(0xfeff);

/** Выгрузка Битрикса: UTF-8 с BOM, `;`, все поля в кавычках. */
function csv(rows: string[][]): Buffer {
  const body = rows.map((cells) => cells.map((c) => `"${c}"`).join(';')).join('\r\n');
  return Buffer.from(`${BOM}${body}\r\n`, 'utf8');
}

async function first<T>(items: AsyncIterable<T>): Promise<T> {
  for await (const item of items) return item;
  throw new Error('источник ничего не вернул');
}

async function restDeal(closeDate: string = REST_MIDNIGHT): Promise<BitrixDeal> {
  const source = restSource({
    'crm.deal.list': [
      {
        ID: '401',
        TITLE: 'Сделка',
        CATEGORY_ID: '0',
        STAGE_ID: 'EXECUTING',
        CLOSEDATE: closeDate,
      },
    ],
  });
  return first(source.deals({}));
}

async function fileDeal(): Promise<BitrixDeal> {
  const source = new FileBitrixSource([
    {
      entity: 'deal',
      fileName: 'сделки.csv',
      buffer: csv([
        ['ID', 'Название сделки', 'ID направления', 'ID стадии', 'Предполагаемая дата закрытия'],
        ['401', 'Сделка', '0', 'EXECUTING', FILE_DAY],
      ]),
    },
  ]);
  return first(source.deals({}));
}

async function restTask(): Promise<BitrixTask> {
  const source = restSource({
    'tasks.task.list': [{ id: '501', title: 'Позвонить', status: '2', deadline: REST_MIDNIGHT }],
  });
  return first(source.tasks({}));
}

async function fileTask(): Promise<BitrixTask> {
  const source = new FileBitrixSource([
    {
      entity: 'task',
      fileName: 'задачи.csv',
      buffer: csv([
        ['ID', 'Название', 'Статус', 'Крайний срок'],
        ['501', 'Позвонить', '2', FILE_DAY],
      ]),
    },
  ]);
  return first(source.tasks({}));
}

/** Оба вида одного дня: `[из REST, из файла]`. */
async function bothDays(): Promise<Array<{ source: string; at: Date }>> {
  const [rd, fd, rt, ft] = await Promise.all([restDeal(), fileDeal(), restTask(), fileTask()]);
  const out: Array<{ source: string; at: Date }> = [];
  for (const [source, at] of [
    ['сделка из REST', rd.closeDate],
    ['сделка из файла', fd.closeDate],
    ['задача из REST', rt.deadline],
    ['задача из файла', ft.deadline],
  ] as const) {
    if (!at) throw new Error(`${source}: дата не разобралась`);
    out.push({ source, at });
  }
  return out;
}

describe('Битрикс24: день из REST и из файла — один московский день (прогон №37)', () => {
  it('адаптеры: REST даёт полночь по Москве, файл — полночь UTC, разница ровно три часа', async () => {
    expect((await restDeal()).closeDate).toEqual(new Date('2025-11-02T21:00:00.000Z'));
    expect((await fileDeal()).closeDate).toEqual(new Date('2025-11-03T00:00:00.000Z'));
    expect((await restTask()).deadline).toEqual(new Date('2025-11-02T21:00:00.000Z'));
    expect((await fileTask()).deadline).toEqual(new Date('2025-11-03T00:00:00.000Z'));
  });

  it('живой портал: дата-день из REST — тот же МОМЕНТ, что из файла (полночь UTC)', async () => {
    const [rest, file] = await Promise.all([restDeal(REST_PORTAL), fileDeal()]);
    expect(rest.closeDate).toEqual(new Date('2025-11-03T00:00:00.000Z'));
    expect(rest.closeDate).toEqual(file.closeDate);
  });

  it('экран, поле формы и фильтр по дате видят один и тот же день', async () => {
    const range = moscowDayRange(DAY);
    if (!range) throw new Error('день не разобрался');
    for (const { source, at } of await bothDays()) {
      expect(moscowCalendarDay(at), source).toBe(DAY);
      expect(fmtDate(at), source).toBe(FILE_DAY);
      // Значение `<input type="date">` в формах сделки и задачи.
      expect(moscowDayAsUtcMidnight(at).toISOString().slice(0, 10), source).toBe(DAY);
      // Фильтр «с … по …» списка: московские сутки [00:00, 24:00).
      expect(at >= range.gte && at < range.lt, source).toBe(true);
    }
  });

  it('просрочка и «до конца дня»: у обоих видов одна граница в любой час недели', async () => {
    const days = await bothDays();
    const rest = days.filter((d) => d.source.includes('REST'));
    const file = days.filter((d) => d.source.includes('файла'));
    // Каждый час с 01.11 00:00 МСК по 06.11 00:00 МСК.
    for (
      let t = Date.parse('2025-10-31T21:00:00Z');
      t < Date.parse('2025-11-05T21:00:00Z');
      t += 3_600_000
    ) {
      const now = new Date(t);
      for (let k = 0; k < rest.length; k += 1) {
        const [r, f] = [rest[k], file[k]];
        if (!r || !f) throw new Error('пары дат нет');
        const at = moscowCalendarDay(now);
        expect(isPastDue(r.at, now), `${at}: просрочка`).toBe(isPastDue(f.at, now));
        expect(moscowDaysUntil(r.at, now), `${at}: дней до срока`).toBe(moscowDaysUntil(f.at, now));
        expect(r.at < pastDueWhere(now, 3).lt, `${at}: эскалация`).toBe(
          f.at < pastDueWhere(now, 3).lt
        );
        for (const within of [0, 1, 7]) {
          const { lt } = dueByWhere(now, within);
          expect(r.at < lt, `${at}: до конца дня +${within}`).toBe(f.at < lt);
        }
      }
    }
    // И граница там, где её ждёт человек: весь день 03.11 срок не просрочен,
    // с первой минуты 04.11 по Москве — просрочен.
    for (const { source, at } of days) {
      expect(isPastDue(at, new Date('2025-11-03T20:59:59Z')), source).toBe(false);
      expect(isPastDue(at, new Date('2025-11-03T21:00:00Z')), source).toBe(true);
    }
  });

  it('повторный перенос из другого источника дату не переписывает: сделка и задача — «без изменений»', async () => {
    const ctx: MappingContext = {
      companyId: 'company-1',
      importerId: 'user-importer',
      defaultManagerId: 'user-default',
      tables: {
        stageMap: { '0:EXECUTING': 'stage-open' },
        leadStageMap: {},
        taskColumnMap: { '2': 'default:todo' },
        userMap: {},
      },
      resolveUser: () => null,
    };
    const dealStages: readonly TargetStage[] = [
      { id: 'stage-open', name: 'В работе', statusAnchor: 'open', isTerminal: false },
    ];
    const columns: readonly TargetStage[] = [
      { id: 'default:todo', name: 'К выполнению', statusAnchor: 'todo', isTerminal: false },
    ];
    // Сделка и задача уже лежат в базе после переноса из файла.
    const existingDeal: ExistingDeal = {
      id: 'deal-1',
      title: 'Сделка',
      status: 'open',
      stageId: 'stage-open',
      orderId: null,
      organizationId: null,
      wonAt: null,
      lostAt: null,
    };
    const existingTask: ExistingTask = {
      id: 'task-1',
      title: 'Позвонить',
      status: 'todo',
      columnId: null,
      completedAt: null,
    };
    const dealLookup = {
      byBitrixId: () => existingDeal,
      organizationByBitrixId: () => undefined,
      contactByBitrixId: () => undefined,
      leadByBitrixId: () => undefined,
    };
    const taskLookup = {
      byBitrixId: () => existingTask,
      organizationByBitrixId: () => undefined,
      dealByBitrixId: () => undefined,
      leadByBitrixId: () => undefined,
      contactOrganization: () => undefined,
    };

    expect(planDeal(await restDeal(), ctx, dealLookup, dealStages)).toEqual({
      action: 'skip',
      reason: 'no_changes',
      id: 'deal-1',
    });
    expect(planTask(await restTask(), ctx, taskLookup, columns)).toEqual({
      action: 'skip',
      reason: 'no_changes',
      id: 'task-1',
    });
  });
});
