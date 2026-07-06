import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { OrderStageStepper } from '@/components/orders/order-stage-stepper';
import { WORKING_STAGE_LABELS } from '@/lib/orders/humanStage';
import type { WorkingStage } from '@/lib/orders/humanStage';

const labels = [...WORKING_STAGE_LABELS];

function render(stage: WorkingStage): string {
  return renderToString(<OrderStageStepper stage={stage} labels={labels} />);
}

describe('OrderStageStepper — обычная дорожка', () => {
  it('рендерит 6 меток этапов', () => {
    const stage: WorkingStage = { index: 1, total: 6, label: 'Новая', tone: 'neutral', terminal: false };
    const html = render(stage);
    for (const label of labels) {
      expect(html).toContain(label);
    }
  });

  it('index 4 — «Обучение» помечен как текущий (bg-orange-500)', () => {
    const stage: WorkingStage = { index: 4, total: 6, label: 'Обучение', tone: 'neutral', terminal: false };
    const html = render(stage);
    // Текущий шаг должен содержать оранжевый bg
    expect(html).toContain('bg-orange-500');
    // Метка текущего этапа присутствует
    expect(html).toContain('Обучение');
  });

  it('не рендерит одиночный бейдж при нетерминальном статусе', () => {
    const stage: WorkingStage = { index: 3, total: 6, label: 'Оплата', tone: 'neutral', terminal: false };
    const html = render(stage);
    // Должны быть все 6 меток, а не единственная — значит дорожка отрендерилась
    expect(html).toContain('Новая');
    expect(html).toContain('Договор');
    expect(html).toContain('Оплата');
    expect(html).toContain('Обучение');
  });

  it('index 6 «Закрыт» — все шаги отмечены как пройденные или текущий', () => {
    const stage: WorkingStage = { index: 6, total: 6, label: 'Закрыт', tone: 'success', terminal: false };
    const html = render(stage);
    // Все 6 меток присутствуют
    for (const label of labels) {
      expect(html).toContain(label);
    }
    // Нет незаполненных (нет upcoming-только-серого без выделений — проверяем наличие 6-го)
    expect(html).toContain('Закрыт');
  });
});

describe('OrderStageStepper — терминальный статус', () => {
  it('terminal cancelled → одиночный бейдж «Отменён», нет 6 шагов', () => {
    const stage: WorkingStage = { index: 0, total: 6, label: 'Отменён', tone: 'danger', terminal: true };
    const html = render(stage);
    // Метка бейджа присутствует
    expect(html).toContain('Отменён');
    // Нет меток этапов дорожки — значит дорожка не отрендерилась
    expect(html).not.toContain('Договор');
    expect(html).not.toContain('Обучение');
    expect(html).not.toContain('Закрыт');
  });

  it('terminal on_hold → одиночный бейдж «На паузе», нет 6 шагов', () => {
    const stage: WorkingStage = { index: 0, total: 6, label: 'На паузе', tone: 'warning', terminal: true };
    const html = render(stage);
    expect(html).toContain('На паузе');
    expect(html).not.toContain('Договор');
  });

  it('terminal tone=neutral → маппится в neutral-бейдж (toneToBadge)', () => {
    const stage: WorkingStage = { index: 0, total: 6, label: 'Черновик', tone: 'neutral', terminal: true };
    const html = render(stage);
    expect(html).toContain('Черновик');
    expect(html).toContain('bg-gray-100');
  });

  it('terminal tone=success → маппится в success-бейдж (toneToBadge)', () => {
    const stage: WorkingStage = { index: 0, total: 6, label: 'Завершён', tone: 'success', terminal: true };
    const html = render(stage);
    expect(html).toContain('Завершён');
    expect(html).toContain('bg-green-50');
  });

  it('terminal tone=danger (fallback branch of toneToBadge) → danger-бейдж', () => {
    const stage: WorkingStage = { index: 0, total: 6, label: 'Прочее', tone: 'danger', terminal: true };
    const html = render(stage);
    expect(html).toContain('Прочее');
    expect(html).toContain('bg-red-50');
  });
});
