import { describe, it, expect } from 'vitest';
import { selectDueReminders, REMINDER_THRESHOLDS } from '@/lib/services/training/expiry';

const today = new Date('2026-06-23T07:00:00.000Z');

function cert(id: string, validUntil: string | null, sentThresholds: number[] = []) {
  return { id, validUntil: validUntil ? new Date(validUntil) : null, sentThresholds };
}

describe('selectDueReminders', () => {
  it('экспортирует пороги 90/60/30/7', () => {
    expect(REMINDER_THRESHOLDS).toEqual([90, 60, 30, 7]);
  });

  it('срабатывает на самом большом непройденном пороге, который уже наступил', () => {
    const due = selectDueReminders([cert('c1', '2026-07-22T00:00:00.000Z')], today);
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 30 }]);
  });

  it('не дублирует уже отправленный порог', () => {
    const due = selectDueReminders([cert('c1', '2026-07-22T00:00:00.000Z', [30])], today);
    expect(due).toEqual([]);
  });

  it('игнорирует удостоверения без срока и уже просроченные', () => {
    expect(selectDueReminders([cert('c1', null)], today)).toEqual([]);
    expect(selectDueReminders([cert('c2', '2026-06-01T00:00:00.000Z')], today)).toEqual([]);
  });

  it('на границе ровно 7 дней — порог 7 срабатывает', () => {
    const due = selectDueReminders([cert('c1', '2026-06-30T00:00:00.000Z')], today);
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 7 }]);
  });
});
