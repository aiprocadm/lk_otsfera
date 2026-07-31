/**
 * Unit tests extending coverage for orders/humanStage.ts — covers branches
 * not hit by the existing orders.orderStage.test.ts.
 *
 * Specifically:
 * - executionStage: 'pending', 'in_progress', 'completed', and default/fallthrough
 * - paymentStage: not_billed with completed=false (neutral tone)
 * - orderStage: completed execution + refunded finance
 */
import { describe, it, expect } from 'vitest';
import { executionStage, paymentStage, orderStage } from '@/lib/orders/humanStage';

describe('executionStage — all cases', () => {
  it('pending → Новый (neutral)', () => {
    expect(executionStage('pending')).toEqual({ label: 'Новый', tone: 'neutral' });
  });
  it('in_progress → В работе (neutral)', () => {
    expect(executionStage('in_progress')).toEqual({ label: 'В работе', tone: 'neutral' });
  });
  it('on_hold → На паузе (warning)', () => {
    expect(executionStage('on_hold')).toEqual({ label: 'На паузе', tone: 'warning' });
  });
  it('completed → Завершён (success)', () => {
    expect(executionStage('completed')).toEqual({ label: 'Завершён', tone: 'success' });
  });
  it('cancelled → Отменён (danger)', () => {
    expect(executionStage('cancelled')).toEqual({ label: 'Отменён', tone: 'danger' });
  });
  it('unknown value → — (neutral) via default branch', () => {
    // TypeScript won't allow unknown values at compile time, but we test the default arm
    const result = executionStage('unknown_status' as never);
    expect(result).toEqual({ label: '—', tone: 'neutral' });
  });
});

describe('paymentStage — additional branches', () => {
  it('not_billed, no payments, not completed → Счёт не выставлен (neutral)', () => {
    const s = paymentStage({ financialStatus: 'not_billed', amount: '100', paidTotal: '0' });
    expect(s).toEqual({ label: 'Счёт не выставлен', tone: 'neutral' });
  });
  it('not_billed, no payments, completed=true → Счёт не выставлен (warning)', () => {
    const s = paymentStage({
      financialStatus: 'not_billed',
      amount: '100',
      paidTotal: '0',
      completed: true,
    });
    expect(s).toEqual({ label: 'Счёт не выставлен', tone: 'warning' });
  });
  it('not_billed, completed=false explicit → Счёт не выставлен (neutral)', () => {
    const s = paymentStage({
      financialStatus: 'not_billed',
      amount: '100',
      paidTotal: '0',
      completed: false,
    });
    expect(s).toEqual({ label: 'Счёт не выставлен', tone: 'neutral' });
  });
  it('partially_paid status, 0 actual payments → Счёт выставлен (neutral)', () => {
    // financialStatus=partially_paid but paid=0 → "Счёт выставлен"
    const s = paymentStage({ financialStatus: 'partially_paid', amount: '100', paidTotal: '0' });
    expect(s).toEqual({ label: 'Счёт выставлен', tone: 'neutral' });
  });
  it('refunded → Возврат (danger)', () => {
    const s = paymentStage({ financialStatus: 'refunded', amount: '100', paidTotal: '100' });
    expect(s).toEqual({ label: 'Возврат', tone: 'danger' });
  });
  it('amount=0 with paid=0 → NOT Оплачен (amount must be >0)', () => {
    const s = paymentStage({ financialStatus: 'not_billed', amount: '0', paidTotal: '0' });
    // amount=0 means the condition "paid >= amount" with amount=0 is technically >=, but
    // the condition also requires amount > 0. So it falls through.
    expect(s.label).not.toBe('Оплачен');
  });
});

describe('orderStage — additional combined cases', () => {
  it('completed + refunded → Возврат (finance priority)', () => {
    const s = orderStage({
      executionStatus: 'completed',
      financialStatus: 'refunded',
      amount: '100',
      paidTotal: '100',
    });
    expect(s).toEqual({ label: 'Возврат', tone: 'danger' });
  });

  it('pending + not_billed → Новый, счёт не выставлен (neutral)', () => {
    const s = orderStage({
      executionStatus: 'pending',
      financialStatus: 'not_billed',
      amount: '500',
      paidTotal: '0',
    });
    expect(s).toEqual({ label: 'Новый, счёт не выставлен', tone: 'neutral' });
  });

  it('in_progress + not_billed → В работе, счёт не выставлен (neutral)', () => {
    const s = orderStage({
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
      amount: '100',
      paidTotal: '0',
    });
    expect(s.label).toBe('В работе, счёт не выставлен');
  });

  it('completed + full payment → Завершён, оплачен (success)', () => {
    const s = orderStage({
      executionStatus: 'completed',
      financialStatus: 'paid',
      amount: '100',
      paidTotal: '100',
    });
    expect(s).toEqual({ label: 'Завершён, оплачен', tone: 'success' });
  });

  it('combined label: pay.label starts with uppercase but combined has lowercase', () => {
    const s = orderStage({
      executionStatus: 'in_progress',
      financialStatus: 'billed',
      amount: '100',
      paidTotal: '0',
    });
    // exec.label = "В работе", pay.label = "Счёт выставлен" → lower = "счёт выставлен"
    expect(s.label).toBe('В работе, счёт выставлен');
  });
});
