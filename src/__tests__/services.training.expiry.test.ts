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

/**
 * Прогон сопровождения №36 (`Р-М-3`): остаток — московские дни, как у значков
 * реестра (`moscowDaysUntil`), а не `Math.ceil` от момента прогона. Прогон по
 * расписанию — 07:00 МСК (04:00 UTC); удостоверение из формы хранит срок
 * полуночью UTC (03:00 МСК того же дня).
 */
describe('selectDueReminders — московские дни (прогон №36)', () => {
  it('срок «30.09 12:00 МСК», прогон 07:00 МСК 23.09 — порог 7 сегодня, а не завтра', () => {
    const due = selectDueReminders(
      [cert('c1', '2026-09-30T12:00:00+03:00', [30])],
      new Date('2026-09-23T04:00:00.000Z')
    );
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 7 }]);
  });

  it('прогон в 01:30 МСК 23.09 (22:30 UTC 22.09): до 30.09 ровно 7 московских дней', () => {
    const due = selectDueReminders(
      [cert('c1', '2026-09-30T00:00:00.000Z', [30])],
      new Date('2026-09-22T22:30:00.000Z')
    );
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 7 }]);
  });

  it('последний день: срок 30.09, прогон 07:00 МСК 30.09 — напоминание уходит', () => {
    const due = selectDueReminders(
      [cert('c1', '2026-09-30T00:00:00.000Z')],
      new Date('2026-09-30T04:00:00.000Z')
    );
    expect(due).toEqual([{ certificateId: 'c1', thresholdDays: 7 }]);
  });

  it('00:30 МСК 01.10 (21:30 UTC 30.09): срок 30.09 уже истёк — напоминания нет', () => {
    const due = selectDueReminders(
      [cert('c1', '2026-09-30T00:00:00.000Z')],
      new Date('2026-09-30T21:30:00.000Z')
    );
    expect(due).toEqual([]);
  });
});
