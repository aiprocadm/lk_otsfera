/**
 * Шкала этапов карточки заказа из справочника статусов (этап 5 ТЗ 28.10.2026,
 * `У-353`, `В-ТР-4` (1), РК 8).
 *
 * Раньше шкала рисовала жёсткие шесть шагов, вычисленные из скрытого
 * `executionStatus`, и со статусами заказа не совпадала: тестировщик видел
 * «Новая» там, где в «Статусе заказа» стояло другое. Теперь шаги — активные
 * нетерминальные статусы справочника в его порядке; переименовали или
 * добавили статус — шкала изменилась вместе с ним.
 */

type StatusStepState = 'done' | 'current' | 'upcoming';

type StatusStep = { id: string; label: string; state: StatusStepState };

export type StatusSteps = {
  steps: StatusStep[];
  /** Заказ в терминальном статусе («Отменена») — шкала показывается с пометкой. */
  terminalLabel: string | null;
  /**
   * Текущий статус выключен в справочнике и в шкалу не попал (старые заказы с
   * «Документы выданы» после 16.10): шкала без подсветки, статус — словами.
   */
  offPipelineLabel: string | null;
};

type StatusRow = { id: string; label: string; isActive: boolean; isTerminal: boolean };

export function buildStatusSteps(all: StatusRow[], currentId: string | null): StatusSteps {
  const pipeline = all.filter((s) => s.isActive && !s.isTerminal);
  const current = all.find((s) => s.id === currentId) ?? null;
  const idx = current ? pipeline.findIndex((s) => s.id === current.id) : -1;

  const steps = pipeline.map((s, i): StatusStep => ({
    id: s.id,
    label: s.label,
    state: idx === -1 ? 'upcoming' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming',
  }));

  return {
    steps,
    terminalLabel: current?.isTerminal ? current.label : null,
    offPipelineLabel: current && !current.isTerminal && idx === -1 ? current.label : null,
  };
}
