// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Сводка «Контрагенты» в предпросмотре импорта выписки (`У-92`).
 *
 * Исходная жалоба заказчика была именно про неё: фраза «создано 3
 * организации» без ответа «а остальные почему нет» ничего не объясняет.
 * Поэтому здесь проверяется, что экран показывает **все** шесть чисел, причины
 * отказа словами и честную оговорку про ЕГРЮЛ.
 */
const actions = vi.hoisted(() => ({
  previewPaymentImportAction: vi.fn(),
  commitPaymentImportAction: vi.fn(),
}));
vi.mock('@/server-actions/payment-import', () => actions);

import { PaymentImportForm } from '@/components/import/payment-import-form';

const summary = (over: Partial<Record<string, unknown>> = {}) => ({
  total: 10,
  innFromFile: 4,
  innFromDadata: 2,
  withoutInn: 4,
  alreadyKnown: 3,
  willCreate: 5,
  reasons: {},
  dadataUsed: true,
  dadataReason: null,
  ...over,
});

const previewWith = (counterparties: unknown) => ({
  ok: true,
  plan: {
    counts: {
      orders: { create: 0, update: 0, skip: 0 },
      payments: { create: 1, update: 0, skip: 0 },
      excludedByReason: {},
      queuedByReason: {},
    },
    counterparties,
  },
});

/** Выбрать файл и запустить проверку. */
async function runPreview(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'выписка.xlsx', { type: 'application/vnd.ms-excel' })] },
  });
  fireEvent.submit(container.querySelector('form')!);
  await screen.findByTestId('payment-import-plan');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Сводка «Контрагенты»', () => {
  it('показывает все шесть чисел — иначе «создано 3» ничего не объясняет', async () => {
    actions.previewPaymentImportAction.mockResolvedValue(previewWith(summary()));

    const { container } = render(<PaymentImportForm />);
    await runPreview(container);

    const card = screen.getByTestId('payment-import-counterparties');
    for (const label of [
      'в файле',
      'с ИНН из файла',
      'ИНН найден в ЕГРЮЛ',
      'без ИНН',
      'уже есть в системе',
      'будет создано',
    ]) {
      expect(card.textContent).toContain(label);
    }
  });

  it('причины, по которым организации не будут созданы, названы словами', async () => {
    actions.previewPaymentImportAction.mockResolvedValue(
      previewWith(summary({ reasons: { no_name: 2, inn_other_company: 1 } }))
    );

    const { container } = render(<PaymentImportForm />);
    await runPreview(container);

    const card = screen.getByTestId('payment-import-counterparties');
    expect(card.textContent).toContain('Почему не будут созданы');
    // Код причины переводится на русский, а не показывается как есть.
    expect(card.textContent).toContain('создавать нечего');
    expect(card.textContent).toContain('уже есть в другой компании');
    expect(card.textContent).not.toContain('no_name');
  });

  it.each([
    ['disabled', 'справочник DaData не включён'],
    ['failed', 'DaData не ответил'],
    [null, 'ЕГРЮЛ не понадобился'],
  ])('оговорка про ЕГРЮЛ («%s») честная', async (dadataReason, text) => {
    actions.previewPaymentImportAction.mockResolvedValue(
      previewWith(summary({ dadataUsed: false, dadataReason }))
    );

    const { container } = render(<PaymentImportForm />);
    await runPreview(container);

    expect(screen.getByTestId('payment-import-counterparties').textContent).toContain(text);
  });

  it('ЕГРЮЛ использовался — лишней оговорки нет', async () => {
    actions.previewPaymentImportAction.mockResolvedValue(previewWith(summary()));

    const { container } = render(<PaymentImportForm />);
    await runPreview(container);

    const card = screen.getByTestId('payment-import-counterparties');
    expect(card.textContent).not.toContain('ЕГРЮЛ не');
  });

  it('сводки в ответе нет — карточка не рисуется, а не показывает нули', async () => {
    actions.previewPaymentImportAction.mockResolvedValue(previewWith(undefined));

    const { container } = render(<PaymentImportForm />);
    await runPreview(container);

    expect(screen.queryByTestId('payment-import-counterparties')).toBeNull();
  });
});
