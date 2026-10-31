import { describe, it, expect } from 'vitest';
import { buildStatusSteps } from '@/lib/orders/statusSteps';

/**
 * Шкала этапов карточки заказа из справочника статусов (этап 5 ТЗ 28.10.2026,
 * `У-353`, `В-ТР-4` (1)). Набор — как после 16.10: «Документы выданы» выключен,
 * «Отменена» — терминальная, вне порядка.
 */

const ALL = [
  { id: 'draft', label: 'Черновик заявки', isActive: true, isTerminal: false },
  { id: 'accepted', label: 'Принято в работу', isActive: true, isTerminal: false },
  { id: 'paid', label: 'Оплата поступила', isActive: true, isTerminal: false },
  { id: 'docs', label: 'Документы выданы', isActive: false, isTerminal: false },
  { id: 'closed', label: 'Заказ закрыт', isActive: true, isTerminal: false },
  { id: 'cancelled', label: 'Отменена', isActive: true, isTerminal: true },
];
const states = (currentId: string | null) =>
  buildStatusSteps(ALL, currentId).steps.map((s) => `${s.id}:${s.state}`);

describe('buildStatusSteps', () => {
  it('шаги — активные нетерминальные статусы справочника, в его порядке', () => {
    expect(buildStatusSteps(ALL, 'draft').steps.map((s) => s.label)).toEqual([
      'Черновик заявки',
      'Принято в работу',
      'Оплата поступила',
      'Заказ закрыт',
    ]);
  });

  it('пройденные — done, текущий — current, впереди — upcoming', () => {
    expect(states('paid')).toEqual([
      'draft:done',
      'accepted:done',
      'paid:current',
      'closed:upcoming',
    ]);
    const res = buildStatusSteps(ALL, 'paid');
    expect(res.terminalLabel).toBeNull();
    expect(res.offPipelineLabel).toBeNull();
  });

  it('отменённый — пометка, шаги без подсветки', () => {
    const res = buildStatusSteps(ALL, 'cancelled');
    expect(res.terminalLabel).toBe('Отменена');
    expect(res.offPipelineLabel).toBeNull();
    expect(res.steps.every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('статус выключен в справочнике — словами, без подсветки шага', () => {
    const res = buildStatusSteps(ALL, 'docs');
    expect(res.offPipelineLabel).toBe('Документы выданы');
    expect(res.terminalLabel).toBeNull();
    expect(res.steps.map((s) => s.id)).not.toContain('docs');
    expect(res.steps.every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('заказ без статуса и неизвестный статус — шкала без подсветки и без пометок', () => {
    for (const id of [null, 'нет-такого']) {
      const res = buildStatusSteps(ALL, id);
      expect(res.steps.every((s) => s.state === 'upcoming')).toBe(true);
      expect(res.terminalLabel).toBeNull();
      expect(res.offPipelineLabel).toBeNull();
    }
  });

  it('переименовали статус в справочнике — шкала изменилась вместе с ним', () => {
    const renamed = ALL.map((s) => (s.id === 'paid' ? { ...s, label: 'Деньги пришли' } : s));
    expect(buildStatusSteps(renamed, 'paid').steps[2]).toEqual({
      id: 'paid',
      label: 'Деньги пришли',
      state: 'current',
    });
  });
});
