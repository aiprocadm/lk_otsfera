import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ManagerDocUploadForm } from '@/components/manager/manager-doc-upload-form';
describe('ManagerDocUploadForm', () => {
  it('renders file input, type select, recipient select and submit button', () => {
    const html = renderToString(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    expect(html).toContain('type="file"');
    expect(html).toContain('Получатель');
    expect(html).toContain('Загрузить');
  });
  it('includes the commission_statement option and both recipients', () => {
    const html = renderToString(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    expect(html).toContain('Расчёт комиссии');
    expect(html).toContain('Организация');
    expect(html).toContain('Партнёр');
  });
});
