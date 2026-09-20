/**
 * Вкладка «Автообмен» — одна на кабинет администратора и руководителя
 * (`У-118`, дефект `Д-33`).
 *
 * У руководителя этой вкладки раньше не существовало: переключатель её
 * показывал, а клик приводил на «страница не найдена». При вставшем обмене он
 * ничего не мог ни увидеть, ни сделать.
 *
 * Что проверяется здесь — **граница между ролями**. Запуск («сходить за
 * свежими данными сейчас») обратим и есть у обоих. Пауза расписания и
 * перемотка курсора — рычаги платформенные: обмен с 1С один на все компании,
 * и остановка задевает чужие данные. Поэтому у руководителя вместо рычагов —
 * текстом «на паузе»/«работает»: видеть состояние он обязан, менять — нет.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Управляющие кнопки — клиентские; здесь важно, ЕСТЬ ли рычаг у роли, а не
// как он нарисован. У каждого свой тест.
vi.mock('@/components/admin/sync-trigger-button', () => ({
  SyncTriggerButton: (p: { entity: string; label?: string }) => (
    <button data-testid={`trigger-${p.entity}`}>{p.label ?? 'Запустить'}</button>
  ),
}));
vi.mock('@/components/admin/sync-schedule-toggle', () => ({
  SyncScheduleToggle: (p: { schedulerId: string; paused: boolean }) => (
    <button data-testid={`toggle-${p.schedulerId}`} data-paused={String(p.paused)} />
  ),
}));
vi.mock('@/components/admin/sync-cursor-dialog', () => ({
  SyncCursorDialog: (p: { entity: string }) => <div data-testid={`cursor-${p.entity}`} />,
}));
vi.mock('@/components/admin/sync-schedule-editor', () => ({
  SyncScheduleEditor: (p: { schedulerId: string; isDefault: boolean }) => (
    <div data-testid={`editor-${p.schedulerId}`} data-default={String(p.isDefault)} />
  ),
}));
vi.mock('@/components/admin/pending-records-section', () => ({
  PendingRecordsSection: () => <tr data-testid="pending" />,
}));
vi.mock('@/components/admin/one-c-params-form', () => ({
  OneCParamsForm: () => <div data-testid="params-form" />,
}));
vi.mock('@/server-actions/admin/syncControl', () => ({ saveOneCParamsAction: vi.fn() }));

import { OneCAutoExchange } from '@/components/settings/one-c-auto-exchange';

const ROW = {
  entity: 'order',
  successCount24h: 1,
  warnCount24h: 0,
  errorCount24h: 0,
  lastSuccessAt: new Date('2026-09-19T10:00:00Z'),
  lastErrorAt: null,
  lastErrorMessage: null,
  cursor: '2026-09-19T09:00:00Z',
  lagMs: null,
} as never;

function render(over: Record<string, unknown> = {}) {
  return renderToString(
    <OneCAutoExchange
      cabinet="leader"
      rows={[ROW]}
      queueStats={[]}
      pausedIds={new Set()}
      pendingRecords={[]}
      pendingTotal={0}
      patterns={new Map()}
      paramsView={[]}
      companies={[]}
      {...(over as never)}
    />
  ).replace(/<!-- -->/g, '');
}

describe('Руководитель: видит, но не переключает', () => {
  it('состояние расписания — словами, рычага нет', () => {
    const out = render({ pausedIds: new Set(['oneCSync.pullOrders.cron']) });

    expect(out).toContain('на паузе');
    expect(out).not.toContain('data-testid="toggle-oneCSync.pullOrders.cron"');
    // Перемотка курсора — тоже платформенный рычаг, его нет.
    expect(out).not.toContain('data-testid="cursor-order"');
  });

  it('работающее расписание так и подписано', () => {
    const out = render();

    expect(out).toContain('работает');
    expect(out).not.toContain('на паузе');
  });

  it('запуск руками есть у обеих ролей — последствия обратимы', () => {
    const out = render();

    expect(out).toContain('data-testid="trigger-order"');
    expect(out).toContain('data-testid="trigger-reconcile"');
    expect(out).toContain('data-testid="trigger-reconcileDebts"');
  });

  it('паузы обеих сверок показаны каждая своей строкой', () => {
    const out = render({
      pausedIds: new Set(['oneCSync.reconcile.cron', 'oneCSync.reconcileDebts.cron']),
    });

    // Две сверки — две задачи: дебиторка ничего не правит, а обычная правит.
    expect(out.match(/на паузе/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('«сейчас выполняется» видно по каждой очереди отдельно', () => {
    const out = render({
      queueStats: [
        { queue: 'oneCSync.pullOrders', counts: { active: 1 } },
        { queue: 'oneCSync.reconcileDebts', counts: { active: 2 } },
      ],
    });

    expect(out.match(/выполняется/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('параметры обмена — на чтение, с человеческими значениями по умолчанию', () => {
    const out = render();

    expect(out).toContain('боевой — читаем и пишем');
    expect(out).toContain('15000 мс');
    expect(out).toContain('5 мин');
    // Форма правки — только у администратора.
    expect(out).not.toContain('data-testid="params-form"');
  });

  it('теневой режим назван прямо: в 1С не пишем', () => {
    const out = render({ paramsView: [{ key: 'onec.mode', value: 'shadow' }] });

    expect(out).toContain('теневой — в 1С не пишем');
  });
});

describe('Администратор: рычаги на месте', () => {
  const asAdmin = (over: Record<string, unknown> = {}) => render({ cabinet: 'admin', ...over });

  it('пауза, курсор и правка расписания доступны', () => {
    const out = asAdmin();

    expect(out).toContain('data-testid="toggle-oneCSync.pullOrders.cron"');
    expect(out).toContain('data-testid="cursor-order"');
    expect(out).toContain('data-testid="editor-oneCSync.pullOrders.cron"');
  });

  it('расписание не переопределено — редактор знает, что оно по умолчанию', () => {
    expect(asAdmin()).toContain('data-default="true"');
    expect(asAdmin({ patterns: new Map([['oneCSync.pullOrders.cron', '0 * * * *']]) })).toContain(
      'data-default="false"'
    );
  });

  it('очередь разбора показывается только администратору', () => {
    expect(asAdmin()).toContain('data-testid="pending"');
    expect(render()).not.toContain('data-testid="pending"');
  });
});
