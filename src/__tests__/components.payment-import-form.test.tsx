import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/server-actions/payment-import', () => ({ previewPaymentImportAction: vi.fn(), commitPaymentImportAction: vi.fn() }));

import { PaymentImportForm } from '@/components/import/payment-import-form';

describe('PaymentImportForm', () => {
  it('renders file input accepting .xls and .xlsx', () => {
    const html = renderToString(<PaymentImportForm />);
    expect(html).toContain('.xls');
    expect(html).toContain('.xlsx');
    expect(html).toMatch(/Загрузить и проверить/);
  });
});
