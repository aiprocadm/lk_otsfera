import { describe, it, expect } from 'vitest';
import { LeadStatus } from '@prisma/client';
import { LEAD_STATUSES, LEAD_STATUS_FILTER_LABELS_RU, isLeadStatus } from '@/lib/leads/statuses';

describe('статусы лида — единый источник (аудит C1)', () => {
  it('карта подписей покрывает ВСЕ значения prisma-enum LeadStatus', () => {
    // Рантайм-пин против дрейфа: тотальность Record<LeadStatus, …> ловит
    // компилятор, а этот тест ловит случай, когда enum расширили, а типы
    // ещё не пересобрали (prisma generate) — список молча стал бы короче.
    expect(LEAD_STATUSES.slice().sort()).toEqual(Object.values(LeadStatus).slice().sort());
  });

  it('содержит promoted_to_deal — статус, которого не хватало в фильтрах', () => {
    expect(LEAD_STATUSES).toContain('promoted_to_deal');
    expect(LEAD_STATUS_FILTER_LABELS_RU.promoted_to_deal).toBe('Переданы в сделку');
  });

  it('порядок ключей = порядок вкладок фильтра', () => {
    expect(LEAD_STATUSES).toEqual([
      'new',
      'in_review',
      'qualified',
      'promoted_to_order',
      'promoted_to_deal',
      'rejected',
    ]);
  });

  it('isLeadStatus: пропускает известный статус и отвергает мусор', () => {
    expect(isLeadStatus('qualified')).toBe(true);
    expect(isLeadStatus('promoted_to_deal')).toBe(true);
    expect(isLeadStatus('нет-такого')).toBe(false);
    expect(isLeadStatus('')).toBe(false);
  });
});
