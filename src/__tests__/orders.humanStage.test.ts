import { describe, it, expect } from 'vitest';
import { humanStage } from '@/lib/orders/humanStage';

describe('humanStage', () => {
  it('returns "Новая, не выставлен счёт" for pending + not_billed', () => {
    const stage = humanStage({ executionStatus: 'pending', financialStatus: 'not_billed' });
    expect(stage.label).toBe('Новая, счёт не выставлен');
    expect(stage.tone).toBe('neutral');
  });

  it('returns "В работе, частично оплачена" for in_progress + partially_paid', () => {
    const stage = humanStage({ executionStatus: 'in_progress', financialStatus: 'partially_paid' });
    expect(stage.label).toBe('В работе, частично оплачена');
    expect(stage.tone).toBe('warning');
  });

  it('returns "Завершена, оплачена" for completed + paid', () => {
    const stage = humanStage({ executionStatus: 'completed', financialStatus: 'paid' });
    expect(stage.label).toBe('Завершена, оплачена');
    expect(stage.tone).toBe('success');
  });

  it('marks cancelled regardless of finance as "Отменена"', () => {
    const stage = humanStage({ executionStatus: 'cancelled', financialStatus: 'billed' });
    expect(stage.label).toBe('Отменена');
    expect(stage.tone).toBe('danger');
  });

  it('marks refunded as "Возврат"', () => {
    const stage = humanStage({ executionStatus: 'completed', financialStatus: 'refunded' });
    expect(stage.label).toBe('Возврат');
    expect(stage.tone).toBe('danger');
  });

  it('marks on_hold as "На паузе"', () => {
    const stage = humanStage({ executionStatus: 'on_hold', financialStatus: 'billed' });
    expect(stage.label).toBe('На паузе');
    expect(stage.tone).toBe('warning');
  });

  it('falls back to dash on unknown combo', () => {
    const stage = humanStage({ executionStatus: 'pending', financialStatus: 'refunded' });
    expect(stage.label).toBe('—');
    expect(stage.tone).toBe('neutral');
  });

  it('marks on_hold + not_billed as "На паузе" too (any finance falls under pause)', () => {
    const stage = humanStage({ executionStatus: 'on_hold', financialStatus: 'not_billed' });
    expect(stage.label).toBe('На паузе');
    expect(stage.tone).toBe('warning');
  });
});
