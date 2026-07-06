// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// StatementRow calls useRouter()/useClientResource() unconditionally — stub both
// so the client component can render under react-dom/server (no Next app-router
// provider in the unit harness).
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { useClientResourceMock } = vi.hoisted(() => ({
  useClientResourceMock: vi.fn((..._args: [string, { select: (raw: unknown) => unknown }]) => (
    (void _args, { data: null as unknown, loading: false })
  ))
}));
vi.mock('@/hooks/useClientResource', () => ({
  useClientResource: useClientResourceMock
}));

import { CommissionStatementsList } from '@/components/partner/commission-statements-list';
import type { StatementListItem } from '@/lib/services/partner/finance';

// Walks the rendered HTML counting <button>…</button> nesting depth. Invalid
// nesting (a <button> inside a <button>) is exactly what produces the React
// hydration mismatch we are guarding against.
function maxButtonNesting(html: string): number {
  let depth = 0;
  let max = 0;
  for (const tag of html.match(/<\/?button\b/g) ?? []) {
    if (tag.startsWith('</')) depth--;
    else { depth++; if (depth > max) max = depth; }
  }
  return max;
}

const draft: StatementListItem = {
  id: 's1',
  periodFrom: new Date('2026-01-01'),
  periodTo: new Date('2026-01-31'),
  status: 'draft',
  totalCommissionAmount: '1000.00',
  pdfPath: 'p.pdf',
  xlsxPath: 'x.xlsx',
  itemCount: 2
};

describe('CommissionStatementsList — valid HTML nesting (hydration-safe)', () => {
  it('draft + canManage: action controls render without a <button> nested in a <button>', () => {
    const html = renderToString(
      <CommissionStatementsList statements={[draft]} canManage={true} />
    );
    // The interactive controls that previously sat inside the toggle <button>.
    expect(html).toContain('Утвердить');
    expect(html).toContain('PDF');
    // The toggle header is now role=button, not a real <button>, so nothing
    // interactive is illegally nested.
    expect(html).toContain('role="button"');
    expect(maxButtonNesting(html)).toBeLessThanOrEqual(1);
  });

  it('renders empty state without any statements', () => {
    const html = renderToString(
      <CommissionStatementsList statements={[]} canManage={false} />
    );
    expect(html).toContain('Отчётов ещё нет');
    expect(maxButtonNesting(html)).toBeLessThanOrEqual(1);
  });
});

describe('CommissionStatementsList — coverage extension', () => {
  it('empty + canManage: shows the hint about generating the first statement', () => {
    const html = renderToString(
      <CommissionStatementsList statements={[]} canManage={true} />
    );
    expect(html).toContain('Сформировать за период');
  });

  it('same-month period renders "мес год"; different months render a date range', () => {
    const sameMonth: StatementListItem = { ...draft, periodFrom: new Date('2026-03-01'), periodTo: new Date('2026-03-31') };
    const crossMonth: StatementListItem = { ...draft, id: 's2', periodFrom: new Date('2026-03-01'), periodTo: new Date('2026-04-15') };
    const htmlSame = renderToString(<CommissionStatementsList statements={[sameMonth]} canManage={false} />);
    const htmlCross = renderToString(<CommissionStatementsList statements={[crossMonth]} canManage={false} />);
    expect(htmlSame).toContain('мар 2026');
    expect(htmlCross).toContain('—');
  });

  it('renders each status label and color, falling back to the raw string for an unknown status', () => {
    const approved: StatementListItem = { ...draft, id: 's2', status: 'approved' };
    const paid: StatementListItem = { ...draft, id: 's3', status: 'paid' };
    const superseded: StatementListItem = { ...draft, id: 's4', status: 'superseded' };
    const unknown: StatementListItem = { ...draft, id: 's5', status: 'weird_status' as StatementListItem['status'] };

    expect(renderToString(<CommissionStatementsList statements={[approved]} canManage={false} />)).toContain('Утверждён');
    expect(renderToString(<CommissionStatementsList statements={[paid]} canManage={false} />)).toContain('Выплачен');
    expect(renderToString(<CommissionStatementsList statements={[superseded]} canManage={false} />)).toContain('Заменён');
    const htmlUnknown = renderToString(<CommissionStatementsList statements={[unknown]} canManage={false} />);
    expect(htmlUnknown).toContain('weird_status');
    expect(htmlUnknown).toContain('bg-gray-100 text-gray-500');
  });

  it('does not render the Утвердить button when canManage is false, even if draft', () => {
    const html = renderToString(<CommissionStatementsList statements={[draft]} canManage={false} />);
    expect(html).not.toContain('Утвердить');
  });

  it('does not render the Утвердить button when status is not draft, even if canManage', () => {
    const approved: StatementListItem = { ...draft, status: 'approved' };
    const html = renderToString(<CommissionStatementsList statements={[approved]} canManage={true} />);
    expect(html).not.toContain('Утвердить');
  });

  it('renders placeholder text instead of a download link when pdfPath/xlsxPath are null', () => {
    const noFiles: StatementListItem = { ...draft, pdfPath: null, xlsxPath: null };
    const html = renderToString(<CommissionStatementsList statements={[noFiles]} canManage={false} />);
    expect(html).toContain('PDF…');
    expect(html).toContain('XLSX…');
  });

  it('pluralizes the item count correctly (1 / 2-4 / 5+)', () => {
    const one: StatementListItem = { ...draft, itemCount: 1 };
    const two: StatementListItem = { ...draft, id: 's2', itemCount: 2 };
    const five: StatementListItem = { ...draft, id: 's3', itemCount: 5 };
    expect(renderToString(<CommissionStatementsList statements={[one]} canManage={false} />)).toContain('заказ<!-- --> ');
    expect(renderToString(<CommissionStatementsList statements={[two]} canManage={false} />)).toContain('заказа');
    expect(renderToString(<CommissionStatementsList statements={[five]} canManage={false} />)).toContain('заказов');
  });
});

describe('CommissionStatementsList — interactive (jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    useClientResourceMock.mockReset();
    useClientResourceMock.mockReturnValue({ data: null, loading: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clicking the header toggles aria-expanded and reveals the items table', () => {
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    const header = screen.getByRole('button', { name: /янв 2026/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Заказ')).toBeTruthy();
  });

  it('while loading, shows the "Загружаю…" row', () => {
    useClientResourceMock.mockReturnValue({ data: null, loading: true });
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: /янв 2026/ }));
    expect(screen.getByText('Загружаю…')).toBeTruthy();
  });

  it('once loaded with items, renders a row per item with formatted amounts and rate', () => {
    useClientResourceMock.mockReturnValue({
      data: [
        {
          id: 'i1',
          orderNumber: '№7',
          organizationName: 'ООО Ромашка',
          baseAmount: '1000.00',
          rate: '0.15',
          commissionAmount: '150.00'
        }
      ],
      loading: false
    });
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: /янв 2026/ }));
    expect(screen.getByText('№7')).toBeTruthy();
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText('15.00%')).toBeTruthy();
  });

  it('the select mapper passed to useClientResource extracts statement.items from the raw response', () => {
    // Exercise the real select() callback (not the mocked hook return) so its
    // branch/function coverage is genuine, not just the row-rendering path.
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: /янв 2026/ }));
    const optionsArg = useClientResourceMock.mock.calls[0][1];
    expect(optionsArg.select({ statement: { items: [{ id: 'x' }] } })).toEqual([{ id: 'x' }]);
    expect(optionsArg.select({ statement: {} })).toEqual([]);
    expect(optionsArg.select({})).toEqual([]);
  });

  it('item row falls back to em-dash when orderNumber is null', () => {
    useClientResourceMock.mockReturnValue({
      data: [
        { id: 'i1', orderNumber: null, organizationName: 'Орг', baseAmount: '100', rate: '0.1', commissionAmount: '10' }
      ],
      loading: false
    });
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: /янв 2026/ }));
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('loaded with an empty items array shows the "Нет данных" row', () => {
    useClientResourceMock.mockReturnValue({ data: [], loading: false });
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: /янв 2026/ }));
    expect(screen.getByText('Нет данных')).toBeTruthy();
  });

  it('clicking an action button (e.g. PDF link) does not toggle the row open (stopPropagation)', () => {
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    const header = screen.getByRole('button', { name: /янв 2026/ });
    fireEvent.click(screen.getByText('PDF'));
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('Утвердить: success path calls PATCH, toasts and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<CommissionStatementsList statements={[draft]} canManage={true} />);
    fireEvent.click(screen.getByText('Утвердить'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/finance/statements/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'approve' }) })
    );
  });

  it('Утвердить: error path does not refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<CommissionStatementsList statements={[draft]} canManage={true} />);
    fireEvent.click(screen.getByText('Утвердить'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pressing Enter on the header toggles it open (keyboard access)', () => {
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    const header = screen.getByRole('button', { name: /янв 2026/ });
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('pressing Space on the header toggles it open (keyboard access)', () => {
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    const header = screen.getByRole('button', { name: /янв 2026/ });
    fireEvent.keyDown(header, { key: ' ' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('pressing an unrelated key on the header does not toggle it', () => {
    render(<CommissionStatementsList statements={[draft]} canManage={false} />);
    const header = screen.getByRole('button', { name: /янв 2026/ });
    fireEvent.keyDown(header, { key: 'a' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });
});
