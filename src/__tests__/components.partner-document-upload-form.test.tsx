import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';
describe('PartnerDocumentUploadForm', () => {
  it('renders the file input, type select and submit button', () => {
    const html = renderToString(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    expect(html).toContain('type="file"');
    expect(html).toContain('<select');
    expect(html).toContain('Отправить');
  });
  it('renders all document-type options', () => {
    const html = renderToString(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    expect(html).toContain('Договор');
    expect(html).toContain('Прочее');
  });
});
