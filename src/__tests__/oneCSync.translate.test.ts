import { describe, it, expect } from 'vitest';
import { translateFinancialStatus, translateExecutionStatus } from '@/lib/services/oneCSync/translate';

describe('translateFinancialStatus', () => {
  it('maps known RU labels to enum', () => {
    expect(translateFinancialStatus('Оплачено')).toEqual({ ok: true, value: 'paid' });
    expect(translateFinancialStatus('Частично оплачено')).toEqual({ ok: true, value: 'partially_paid' });
    expect(translateFinancialStatus('Счёт выставлен')).toEqual({ ok: true, value: 'billed' });
  });
  it('is case/space-insensitive', () => {
    expect(translateFinancialStatus('  оплачено ')).toEqual({ ok: true, value: 'paid' });
  });
  it('returns not-ok for unknown', () => {
    expect(translateFinancialStatus('Марсианский статус')).toEqual({ ok: false });
  });
});
describe('translateExecutionStatus', () => {
  it('maps known labels', () => {
    expect(translateExecutionStatus('В работе')).toEqual({ ok: true, value: 'in_progress' });
    expect(translateExecutionStatus('Выполнен')).toEqual({ ok: true, value: 'completed' });
  });
});
