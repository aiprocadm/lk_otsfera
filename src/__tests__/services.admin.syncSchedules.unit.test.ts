import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  getSchedulePatterns,
  saveSchedulePattern,
  syncCronKey,
} from '@/lib/services/admin/syncSchedules';
import { SYNC_SCHEDULES } from '@/lib/jobs/scheduling';

/**
 * `У-125`: расписание правится из интерфейса. Ключевые инварианты — умолчание
 * из кода остаётся, испорченное значение обмен не останавливает, чужая задача
 * не создаёт мусорную запись.
 */
const FIRST = SYNC_SCHEDULES[0]!;

function makeDb(rows: Array<{ key: string; value: string | null }> = []) {
  return {
    integrationSetting: {
      findMany: vi.fn().mockResolvedValue(rows),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('getSchedulePatterns', () => {
  it('без записей в базе действуют умолчания из кода', async () => {
    const patterns = await getSchedulePatterns(makeDb());
    for (const s of SYNC_SCHEDULES) {
      expect(patterns.get(s.schedulerId)).toBe(s.pattern);
    }
  });

  it('заданное в интерфейсе перекрывает умолчание', async () => {
    const db = makeDb([{ key: syncCronKey(FIRST.schedulerId), value: '0 4 * * *' }]);
    const patterns = await getSchedulePatterns(db);
    expect(patterns.get(FIRST.schedulerId)).toBe('0 4 * * *');
  });

  it('испорченное значение игнорируется — обмен не останавливается', async () => {
    // База переживает и ручные правки; лучше работать по умолчанию, чем встать.
    const db = makeDb([{ key: syncCronKey(FIRST.schedulerId), value: 'каждый вторник' }]);
    const patterns = await getSchedulePatterns(db);
    expect(patterns.get(FIRST.schedulerId)).toBe(FIRST.pattern);
  });

  it('пустое значение — это «не задано», а не «пустое расписание»', async () => {
    const db = makeDb([{ key: syncCronKey(FIRST.schedulerId), value: '   ' }]);
    expect((await getSchedulePatterns(db)).get(FIRST.schedulerId)).toBe(FIRST.pattern);
  });

  it('запись о задаче, которой нет в коде, не создаёт лишний ключ', async () => {
    // Иначе удалённая задача продолжала бы «жить» в выдаче.
    const db = makeDb([{ key: syncCronKey('нет.такой.задачи'), value: '0 0 * * *' }]);
    const patterns = await getSchedulePatterns(db);
    expect(patterns.has('нет.такой.задачи')).toBe(false);
  });
});

describe('saveSchedulePattern', () => {
  it('чужая задача отклоняется и в базу не пишет', async () => {
    const db = makeDb();
    expect(await saveSchedulePattern(db, 'u1', 'какая-то.задача', '0 0 * * *')).toEqual({
      ok: false,
      error: 'unknown_schedule',
    });
    const spy = (db as never as { integrationSetting: { upsert: ReturnType<typeof vi.fn> } })
      .integrationSetting.upsert;
    expect(spy).not.toHaveBeenCalled();
  });

  it('невалидное выражение отклоняется с внятной причиной', async () => {
    const db = makeDb();
    const res = await saveSchedulePattern(db, 'u1', FIRST.schedulerId, '99 * * * *');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_cron');
    expect(res.message, 'причина отказа обязана быть внятной').toContain('минуты');
  });

  it('валидное выражение сохраняется и попадает в журнал', async () => {
    const db = makeDb();
    expect(await saveSchedulePattern(db, 'u1', FIRST.schedulerId, '0 4 * * *')).toEqual({
      ok: true,
    });
    const spy = (db as never as { integrationSetting: { upsert: ReturnType<typeof vi.fn> } })
      .integrationSetting.upsert;
    expect(spy.mock.calls[0]![0].create.value).toBe('0 4 * * *');
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'sync_schedule_pattern_changed' })
    );
  });

  it('пустая строка возвращает умолчание — запись удаляется', async () => {
    // Не «выключить»: выключение — это пауза, у неё свой механизм и журнал.
    const db = makeDb();
    expect(await saveSchedulePattern(db, 'u1', FIRST.schedulerId, '  ')).toEqual({ ok: true });
    const del = (db as never as { integrationSetting: { deleteMany: ReturnType<typeof vi.fn> } })
      .integrationSetting.deleteMany;
    expect(del).toHaveBeenCalledWith({ where: { key: syncCronKey(FIRST.schedulerId) } });
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ after: { pattern: null } })
    );
  });
});
