// @vitest-environment jsdom
/**
 * «История импортов» (этап 9, Т-39/Т-40): таблица, disabled-кнопка старше 30
 * дней с подсказкой, диалог подтверждения с явным «Будет удалено…», диалог
 * конфликтов с дефолтом «Отменить» и частичным откатом (Т-37).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { planImportRollbackAction, rollbackImportAction } = vi.hoisted(() => ({
  planImportRollbackAction: vi.fn(),
  rollbackImportAction: vi.fn(),
}));
vi.mock('@/server-actions/import', () => ({ planImportRollbackAction, rollbackImportAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ImportHistory } from '@/components/import/import-history';
import type { ImportBatchListItem } from '@/lib/services/import/rollback';

function batch(over: Partial<ImportBatchListItem> = {}): ImportBatchListItem {
  return {
    id: 'b1',
    createdAt: '2026-08-06T10:00:00.000Z',
    fileName: 'выгрузка.xlsx',
    importedByName: 'Иван',
    status: 'committed',
    rollback: 'available',
    counts: {
      orgs: { created: 1, updated: 0 },
      orders: { created: 2, updated: 1 },
      payments: { created: 3, updated: 0 },
    },
    ...over,
  };
}

const PLAN = {
  ok: true as const,
  plan: {
    toDelete: { organizations: 1, orders: 2, payments: 3 },
    toRestore: 1,
    conflicts: [],
  },
};

beforeAll(() => {
  // jsdom не реализует нативный <dialog> — мокаем императивный мост примитива.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

beforeEach(() => {
  planImportRollbackAction.mockReset().mockResolvedValue(PLAN);
  rollbackImportAction.mockReset();
  toastSuccess.mockClear();
  refresh.mockClear();
});

const openDialog = () => within(document.querySelector('dialog[open]') as HTMLElement);

describe('таблица истории', () => {
  it('пустая история — заглушка', () => {
    render(<ImportHistory batches={[]} />);
    expect(screen.getByText('Импортов ещё не было.')).toBeTruthy();
  });

  it('строка: файл, кто, счётчики, русский статус; откаченный — без кнопки', () => {
    render(
      <ImportHistory
        batches={[
          batch(),
          batch({ id: 'b2', status: 'rolled_back', rollback: 'already_rolled_back' }),
        ]}
      />
    );
    const row = screen.getByTestId('batch-b1');
    expect(row.textContent).toContain('выгрузка.xlsx');
    expect(row.textContent).toContain('Иван');
    expect(row.textContent).toContain('орг. +1/~0');
    expect(row.textContent).toContain('выполнен');
    expect(screen.getByTestId('batch-b2').textContent).toContain('откачен');
    expect(screen.queryByTestId('rollback-b2')).toBeNull();
  });

  it('Т-40: батч старше 30 дней — кнопка неактивна с подсказкой', () => {
    render(<ImportHistory batches={[batch({ rollback: 'expired' })]} />);
    const btn = screen.getAllByTestId('rollback-b1')[0] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Срок отката (30 дней) истёк');
  });

  it('батч без следа записи — кнопка неактивна и объясняет причину (`У-59`)', () => {
    render(<ImportHistory batches={[batch({ rollback: 'nothing_to_revert' })]} />);
    const btn = screen.getAllByTestId('rollback-b1')[0] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('отменять нечего');
  });

  it('кривые данные не роняют таблицу: counts null → «—», пустые счётчики → нули, чужой статус — как есть', () => {
    render(
      <ImportHistory
        batches={[
          batch({ id: 'b3', counts: null, status: 'странный', importedByName: null }),
          batch({ id: 'b4', counts: {} }),
        ]}
      />
    );
    const r3 = screen.getByTestId('batch-b3');
    expect(r3.textContent).toContain('—');
    expect(r3.textContent).toContain('странный');
    expect(screen.getByTestId('batch-b4').textContent).toContain('орг. +0/~0');
  });
});

describe('диалог подтверждения (Т-39)', () => {
  it('клик «Откатить» → план → явный текст «Будет удалено…»; подтверждение выполняет полный откат', async () => {
    rollbackImportAction.mockResolvedValue({
      ok: true,
      status: 'rolled_back',
      deleted: { organizations: 1, orders: 2, payments: 3 },
      restored: 1,
      skippedConflicts: 0,
    });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await waitFor(() => expect(planImportRollbackAction).toHaveBeenCalledWith('b1', 'excel'));

    const summary = await screen.findByTestId('rollback-summary');
    expect(summary.textContent).toContain(
      'Будет удалено: 1 организаций, 2 заказов, 3 платежей. Будет восстановлено: 1 записей.'
    );

    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await waitFor(() => expect(rollbackImportAction).toHaveBeenCalledWith('b1', false, 'excel'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Импорт откачен полностью'));
    expect(refresh).toHaveBeenCalled();
  });

  it('план с конфликтами предупреждает заранее', async () => {
    planImportRollbackAction.mockResolvedValue({
      ok: true,
      plan: {
        ...PLAN.plan,
        conflicts: [
          { entity: 'organization', entityId: 'o1', label: 'ООО', code: 'org_has_users', count: 2 },
        ],
      },
    });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    expect(openDialog().getByText(/Есть конфликты \(1\)/)).toBeTruthy();
  });

  it('отказ плана показывает русскую ошибку', async () => {
    planImportRollbackAction.mockResolvedValue({ ok: false, error: 'expired' });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Срок отката (30 дней) истёк'
      )
    );
  });

  it('неизвестный код отказа плана печатается как есть', async () => {
    planImportRollbackAction.mockResolvedValue({ ok: false, error: 'weird_plan' });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Ошибка: weird_plan'
      )
    );
  });
});

describe('диалог конфликтов (Т-36/Т-37)', () => {
  it('conflicts от сервера → русский список; «Отменить» — дефолт; частичный откат вторым действием', async () => {
    rollbackImportAction
      .mockResolvedValueOnce({
        ok: false,
        error: 'conflicts',
        conflicts: [
          {
            entity: 'payment',
            entityId: 'p1',
            label: 'P-1',
            code: 'payment_in_commission_act',
            count: 2,
          },
          {
            entity: 'organization',
            entityId: 'o1',
            label: 'ООО',
            code: 'blocked_by_child',
            count: 1,
          },
          // Неизвестные код/сущность печатаются как есть — молчать хуже.
          { entity: 'weird', entityId: 'w1', label: 'X', code: 'strange', count: 1 } as never,
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'rollback_partial',
        deleted: { organizations: 0, orders: 1, payments: 0 },
        restored: 0,
        skippedConflicts: 2,
      });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    fireEvent.click(screen.getByTestId('rollback-confirm'));

    const list = await screen.findByTestId('rollback-conflicts');
    expect(list.textContent).toContain('платёж «P-1» — платёж уже в акте комиссии (2)');
    expect(list.textContent).toContain(
      'организация «ООО» — внутри остаются заблокированные записи этого же импорта'
    );
    expect(list.textContent).toContain('weird «X» — связи: strange');

    // Т-37: частичный откат — второе действие.
    fireEvent.click(screen.getByTestId('rollback-partial'));
    await waitFor(() => expect(rollbackImportAction).toHaveBeenLastCalledWith('b1', true, 'excel'));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Откачено частично: конфликтных строк — 2')
    );
  });

  it('«Отменить» закрывает без второго вызова (conflicts без списка — страховка `?? []`)', async () => {
    rollbackImportAction.mockResolvedValueOnce({ ok: false, error: 'conflicts' });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await screen.findByTestId('rollback-conflicts');

    fireEvent.click(screen.getByTestId('rollback-cancel'));
    expect(rollbackImportAction).toHaveBeenCalledTimes(1);
    // Примитив Dialog всегда смонтирован — закрытие проверяется по dialog[open].
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
  });

  it('серверная ошибка отката показывается в диалоге', async () => {
    rollbackImportAction.mockResolvedValueOnce({ ok: false, error: 'already_rolled_back' });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Этот импорт уже откачен'
      )
    );
  });

  it('недоступный сервер — понятная ошибка, не пустой экран', async () => {
    planImportRollbackAction.mockRejectedValue(new Error('net down'));
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Сервер недоступен'
      )
    );
  });

  it('сеть упала на самом откате — та же понятная ошибка', async () => {
    rollbackImportAction.mockRejectedValueOnce(new Error('net down'));
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Сервер недоступен'
      )
    );
  });

  it('неизвестный код ошибки печатается как есть', async () => {
    rollbackImportAction.mockResolvedValueOnce({ ok: false, error: 'weird_code' });
    render(<ImportHistory batches={[batch()]} />);
    fireEvent.click(screen.getAllByTestId('rollback-b1')[0]);
    await screen.findByTestId('rollback-summary');
    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await waitFor(() =>
      expect((document.querySelector('dialog[open]') as HTMLElement).textContent).toContain(
        'Ошибка: weird_code'
      )
    );
  });
});
