import { describe, it, expect } from 'vitest';
import { classifyRow } from '@/lib/services/import/oneCAccountCard/classify';

describe('classifyRow', () => {
  it('Поступление + corr 62.01 → payment', () => {
    expect(classifyRow('Поступление на расчетный счет 0000-001 от ...', '62.01')).toEqual({ kind: 'payment' });
  });
  it('Поступление + corr 62.02 (аванс) → payment', () => {
    expect(classifyRow('Поступление на расчетный счет 0000-002 от ...', '62.02')).toEqual({ kind: 'payment' });
  });
  it('Списание + corr 62 → refund', () => {
    expect(classifyRow('Списание с расчетного счета 0000-003 от ...', '62.01')).toEqual({ kind: 'refund' });
  });
  it('corr 60 → excluded supplier', () => {
    expect(classifyRow('Списание с расчетного счета 0000-004 от ...', '60')).toEqual({ kind: 'excluded', excludeReason: 'supplier' });
  });
  it('corr 91 (банк) → excluded bank_fee', () => {
    expect(classifyRow('Списание с расчетного счета 0000-005 от ...', '91.02')).toEqual({ kind: 'excluded', excludeReason: 'bank_fee' });
  });
  it('Перевод собственных средств → excluded internal_transfer', () => {
    expect(classifyRow('Перевод собственных средств 0000-006 от ...', '57.01')).toEqual({ kind: 'excluded', excludeReason: 'internal_transfer' });
  });
  it('unknown corr → excluded corr_other', () => {
    expect(classifyRow('Поступление на расчетный счет 0000-007 от ...', '76.05')).toEqual({ kind: 'excluded', excludeReason: 'corr_other' });
  });
});
