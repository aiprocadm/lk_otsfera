import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// StatementRow calls useRouter()/useClientResource() unconditionally — stub both
// so the client component can render under react-dom/server (no Next app-router
// provider in the unit harness).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useClientResource', () => ({
  useClientResource: () => ({ data: null, loading: false })
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
