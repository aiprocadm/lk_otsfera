// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { assignOrderManagerAction } = vi.hoisted(() => ({ assignOrderManagerAction: vi.fn() }));
vi.mock('@/server-actions/admin/manager', () => ({ assignOrderManagerAction }));

import { AssignOrderManagerForm } from '@/components/admin/assign-order-manager-form';

const CANDIDATES = [
  { id: 'm1', email: 'zed@x.com', name: null },
  { id: 'm2', email: 'anna@x.com', name: 'Anna' },
];

const THREE_CANDIDATES = [
  { id: 'm1', email: 'zed@x.com', name: null },
  { id: 'm2', email: 'anna@x.com', name: 'Anna' },
  { id: 'm3', email: 'bob@x.com', name: 'Bob' },
];

// Both permutations of (named, nameless) so the comparator's a.name/b.name
// null-coalescing sides both run regardless of the sort algorithm's pivoting.
const MANY_CANDIDATES = [
  { id: 'x1', email: 'nameless-a@x.com', name: null },
  { id: 'x2', email: 'nameless-b@x.com', name: null },
  { id: 'x3', email: 'carl@x.com', name: 'Carl' },
  { id: 'x4', email: 'dana@x.com', name: 'Dana' },
];

describe('AssignOrderManagerForm', () => {
  beforeEach(() => {
    assignOrderManagerAction.mockReset();
  });

  it('renders the "no manager" option and sorts candidates: current-first then alphabetically', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels[0]).toBe('— Без менеджера —');
    // m1 (current) sorts first among candidates despite email z > a
    expect(optionLabels[1]).toBe('zed@x.com');
    expect(optionLabels[2]).toBe('Anna (anna@x.com)');
    expect(select.value).toBe('m1');
  });

  it('sorts alphabetically by name/email when no candidate is current', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels[1]).toBe('Anna (anna@x.com)');
    expect(optionLabels[2]).toBe('zed@x.com');
  });

  it('sorts a larger mixed named/nameless set with no current candidate (exercises both sides of the ?? comparator)', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: MANY_CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    // Alphabetical by (name ?? email): Carl, Dana, nameless-a@x.com, nameless-b@x.com
    expect(optionLabels.slice(1)).toEqual([
      'Carl (carl@x.com)',
      'Dana (dana@x.com)',
      'nameless-a@x.com',
      'nameless-b@x.com',
    ]);
  });

  it('sorts with the currently-assigned candidate in the middle (exercises the b.id branch across 3 candidates)', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm3',
        candidates: THREE_CANDIDATES,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    // m3 (current, "Bob") sorts first; remaining two fall back to alphabetical (Anna, then zed@).
    expect(optionLabels[1]).toBe('Bob (bob@x.com)');
    expect(optionLabels[2]).toBe('Anna (anna@x.com)');
    expect(optionLabels[3]).toBe('zed@x.com');
  });

  it('submit is disabled until the selection differs from currentManagerId', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    const submit = screen.getByRole('button', { name: 'Сохранить' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('null currentManagerId treated as empty string: selecting "" keeps submit disabled', () => {
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: null,
        candidates: CANDIDATES,
      })
    );
    const submit = screen.getByRole('button', { name: 'Сохранить' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('success (changed): shows the "updated" status message', async () => {
    assignOrderManagerAction.mockResolvedValue({ ok: true, changed: true });
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveProperty('textContent', 'Менеджер обновлён.'));
    const fd = assignOrderManagerAction.mock.calls[0][0] as FormData;
    expect(fd.get('orderId')).toBe('o1');
    expect(fd.get('managerUserId')).toBe('m2');
  });

  it('success (unchanged): shows the "no changes" status message', async () => {
    assignOrderManagerAction.mockResolvedValue({ ok: true, changed: false });
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveProperty('textContent', 'Без изменений.'));
  });

  it('error path (invalid_manager) renders the mapped alert', async () => {
    assignOrderManagerAction.mockResolvedValue({ ok: false, error: 'invalid_manager' });
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'Пользователь не является активным менеджером.'
      )
    );
  });

  it('busy state shows "Сохраняем…" on the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    assignOrderManagerAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(
      React.createElement(AssignOrderManagerForm, {
        orderId: 'o1',
        currentManagerId: 'm1',
        candidates: CANDIDATES,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeTruthy());
    resolvePromise({ ok: true, changed: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
