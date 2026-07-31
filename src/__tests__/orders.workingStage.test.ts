import { describe, it, expect } from 'vitest';
import { orderWorkingStage } from '@/lib/orders/humanStage';

const base = {
  executionStatus: 'pending' as const,
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  amount: '100000',
  paidTotal: '0',
};

describe('orderWorkingStage — терминальные состояния вне дорожки', () => {
  it('cancelled → index 0, danger, terminal true', () => {
    const s = orderWorkingStage({ ...base, executionStatus: 'cancelled' });
    expect(s).toEqual({ index: 0, total: 6, label: 'Отменён', tone: 'danger', terminal: true });
  });
  it('on_hold → index 0, warning, terminal true', () => {
    const s = orderWorkingStage({ ...base, executionStatus: 'on_hold' });
    expect(s).toEqual({ index: 0, total: 6, label: 'На паузе', tone: 'warning', terminal: true });
  });
});

describe('orderWorkingStage — 6 вех (1→6)', () => {
  it('index 1 «Новая» — дефолт (ничего не выполнено)', () => {
    const s = orderWorkingStage(base);
    expect(s).toEqual({ index: 1, total: 6, label: 'Новая', tone: 'neutral', terminal: false });
  });

  it('index 2 «Договор» — contractSignedAt != null', () => {
    const s = orderWorkingStage({ ...base, contractSignedAt: new Date('2024-01-01') });
    expect(s).toEqual({ index: 2, total: 6, label: 'Договор', tone: 'neutral', terminal: false });
  });

  it('index 2 «Договор» — contractSignedAt как строка', () => {
    const s = orderWorkingStage({ ...base, contractSignedAt: '2024-01-01' });
    expect(s.index).toBe(2);
  });

  it('index 3 «Оплата» — paidTotal > 0', () => {
    const s = orderWorkingStage({ ...base, paidTotal: '50000' });
    expect(s).toEqual({ index: 3, total: 6, label: 'Оплата', tone: 'neutral', terminal: false });
  });

  it('index 3 «Оплата» — paidTotal как number', () => {
    const s = orderWorkingStage({ ...base, paidTotal: 50000 });
    expect(s.index).toBe(3);
  });

  it('граница paid=0 остаётся index 1 (не переходит на 3)', () => {
    const s = orderWorkingStage({ ...base, paidTotal: '0' });
    expect(s.index).toBe(1);
  });

  it('граница paid=0 как number остаётся index 1', () => {
    const s = orderWorkingStage({ ...base, paidTotal: 0 });
    expect(s.index).toBe(1);
  });

  it('index 4 «Обучение» — executionStatus === in_progress', () => {
    const s = orderWorkingStage({ ...base, executionStatus: 'in_progress' });
    expect(s).toEqual({ index: 4, total: 6, label: 'Обучение', tone: 'neutral', terminal: false });
  });

  it('index 5 «Документы» — executionStatus === completed', () => {
    const s = orderWorkingStage({ ...base, executionStatus: 'completed' });
    expect(s).toEqual({ index: 5, total: 6, label: 'Документы', tone: 'neutral', terminal: false });
  });

  it('index 6 «Закрыт» — closedAt != null, tone success', () => {
    const s = orderWorkingStage({ ...base, closedAt: new Date('2024-06-01') });
    expect(s).toEqual({ index: 6, total: 6, label: 'Закрыт', tone: 'success', terminal: false });
  });
});

describe('orderWorkingStage — монотонность (самая дальняя веха выигрывает)', () => {
  it('completed + closedAt → 6 не 2 (закрытый + договор)', () => {
    const s = orderWorkingStage({
      ...base,
      executionStatus: 'completed',
      contractSignedAt: new Date('2024-01-01'),
      closedAt: new Date('2024-06-01'),
    });
    expect(s.index).toBe(6);
  });

  it('in_progress + paid → 4 (обучение > оплата; in_progress проверяется до paid)', () => {
    const s = orderWorkingStage({
      ...base,
      executionStatus: 'in_progress',
      paidTotal: '50000',
    });
    expect(s.index).toBe(4);
  });

  it('paid (но pending) → 3, не 4', () => {
    const s = orderWorkingStage({ ...base, paidTotal: '50000' });
    expect(s.index).toBe(3);
  });

  it('completed + paid + contractSigned → 5 (completed выигрывает над paid и договором)', () => {
    const s = orderWorkingStage({
      ...base,
      executionStatus: 'completed',
      contractSignedAt: new Date('2024-01-01'),
      paidTotal: '50000',
    });
    expect(s.index).toBe(5);
  });

  it('closedAt выигрывает над completed + paid', () => {
    const s = orderWorkingStage({
      ...base,
      executionStatus: 'completed',
      paidTotal: '50000',
      closedAt: new Date('2024-06-01'),
    });
    expect(s.index).toBe(6);
  });
});

describe('orderWorkingStage — типы входных данных', () => {
  it('closedAt строкой → index 6', () => {
    const s = orderWorkingStage({ ...base, closedAt: '2024-06-01T00:00:00.000Z' });
    expect(s.index).toBe(6);
  });

  it('amount и paidTotal как числа', () => {
    const s = orderWorkingStage({ ...base, amount: 100000, paidTotal: 50000 });
    expect(s.index).toBe(3);
  });

  it('пустая строка contractSignedAt считается null (не достигнута)', () => {
    const s = orderWorkingStage({ ...base, contractSignedAt: '' as unknown as null });
    expect(s.index).toBe(1);
  });
});
