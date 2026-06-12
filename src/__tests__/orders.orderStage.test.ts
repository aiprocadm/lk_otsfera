import { describe, it, expect } from 'vitest';
import { orderStage, paymentStage } from '@/lib/orders/humanStage';

const base = { executionStatus: 'in_progress', financialStatus: 'billed', amount: '100000', paidTotal: '0' } as const;

describe('orderStage — исполнение', () => {
  it('cancelled -> Отменён (danger), оплата не показывается', () => {
    expect(orderStage({ ...base, executionStatus: 'cancelled' })).toEqual({ label: 'Отменён', tone: 'danger' });
  });
  it('on_hold -> На паузе (warning)', () => {
    expect(orderStage({ ...base, executionStatus: 'on_hold' })).toEqual({ label: 'На паузе', tone: 'warning' });
  });
});

describe('orderStage — оплата считается из чисел, не из 1С-статуса', () => {
  it('1С говорит paid, но оплачено 0 -> «счёт выставлен» (контр-кейс DEMO-COMM-001)', () => {
    const s = orderStage({ executionStatus: 'completed', financialStatus: 'paid', amount: '100000', paidTotal: '0' });
    expect(s.label).toBe('Завершён, счёт выставлен');
    expect(s.tone).toBe('warning');
  });
  it('полная оплата -> «оплачен», success', () => {
    const s = orderStage({ executionStatus: 'completed', financialStatus: 'paid', amount: '250000', paidTotal: '250000' });
    expect(s).toEqual({ label: 'Завершён, оплачен', tone: 'success' });
  });
  it('частичная оплата -> warning', () => {
    const s = orderStage({ executionStatus: 'in_progress', financialStatus: 'partially_paid', amount: '480000', paidTotal: '240000' });
    expect(s).toEqual({ label: 'В работе, частично оплачен', tone: 'warning' });
  });
  it('не выставлен счёт и 0 оплат -> «счёт не выставлен»', () => {
    const s = orderStage({ executionStatus: 'pending', financialStatus: 'not_billed', amount: '100', paidTotal: '0' });
    expect(s).toEqual({ label: 'Новый, счёт не выставлен', tone: 'neutral' });
  });
  it('refunded -> Возврат (danger)', () => {
    const s = orderStage({ executionStatus: 'in_progress', financialStatus: 'refunded', amount: '100', paidTotal: '100' });
    expect(s).toEqual({ label: 'Возврат', tone: 'danger' });
  });
  it('переплата (paid > amount) считается оплаченным', () => {
    const s = orderStage({ executionStatus: 'in_progress', financialStatus: 'paid', amount: '100', paidTotal: '150' });
    expect(s).toEqual({ label: 'В работе, оплачен', tone: 'success' });
  });
});

describe('paymentStage — самостоятельный бейдж оплаты', () => {
  it('контр-кейс DEMO-COMM-001: financialStatus=paid, amount=100000, paidTotal=0 -> Счёт выставлен (neutral)', () => {
    const s = paymentStage({ financialStatus: 'paid', amount: '100000', paidTotal: '0' });
    expect(s).toEqual({ label: 'Счёт выставлен', tone: 'neutral' });
  });
  it('тот же кейс с completed:true -> warning', () => {
    const s = paymentStage({ financialStatus: 'paid', amount: '100000', paidTotal: '0', completed: true });
    expect(s).toEqual({ label: 'Счёт выставлен', tone: 'warning' });
  });
  it('полная оплата -> Оплачен (success)', () => {
    const s = paymentStage({ financialStatus: 'paid', amount: '250000', paidTotal: '250000' });
    expect(s).toEqual({ label: 'Оплачен', tone: 'success' });
  });
  it('частичная оплата -> Частично оплачен (warning)', () => {
    const s = paymentStage({ financialStatus: 'partially_paid', amount: '480000', paidTotal: '240000' });
    expect(s).toEqual({ label: 'Частично оплачен', tone: 'warning' });
  });
});
