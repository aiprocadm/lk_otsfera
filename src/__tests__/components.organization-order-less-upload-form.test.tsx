// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh })),
  usePathname: vi.fn(() => '/organization/documents'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

const { uploadOrganizationDocument } = vi.hoisted(() => ({ uploadOrganizationDocument: vi.fn() }));
vi.mock('@/server-actions/organization/documents', () => ({ uploadOrganizationDocument }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import { OrganizationOrderLessUploadForm } from '@/components/organization/organization-order-less-upload-form';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

// See components.organization-document-upload-form.test.tsx for why this bypasses
// the public `files` property: jsdom's own FormData construction (used by React 19's
// <form action>) reads the file input's internal FileList impl directly.
function pickFile(input: HTMLInputElement, file: File): void {
  const implSymbol = Object.getOwnPropertySymbols(file)[0];
  const fileImpl = (file as any)[implSymbol];
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0];
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  flImpl.push(fileImpl);
  fireEvent.change(input);
}

describe('OrganizationOrderLessUploadForm (SSR structure)', () => {
  it('renders the order-less upload form', () => {
    const html = renderToString(
      React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'o1' })
    );
    expect(html).toContain('Загрузить общий документ');
    expect(html).toContain('name="file"');
  });
});

describe('OrganizationOrderLessUploadForm (interactive, jsdom)', () => {
  beforeEach(() => {
    uploadOrganizationDocument.mockReset();
    toastSuccess.mockClear();
    refresh.mockClear();
  });

  it('changing the doc-type select updates the selected value', () => {
    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('other');
    fireEvent.change(select, { target: { value: 'contract' } });
    expect(select.value).toBe('contract');
  });

  it('success path: submits with a file (no orderId, order-less branch), toasts with its name', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('report.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Документ «report.pdf» загружен.')
    );
    expect(uploadOrganizationDocument).toHaveBeenCalled();
    const sentFormData = uploadOrganizationDocument.mock.calls[0][0] as FormData;
    expect(sentFormData.get('organizationId')).toBe('org1');
    expect(sentFormData.get('orderId')).toBeNull();
    expect(sentFormData.get('docType')).toBe('other');
    expect(refresh).toHaveBeenCalled();
  });

  it('submits with no file selected (lastFileNameRef falls back to empty string)', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: true, documentId: 'd2' });
    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByText('Загрузить'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «» загружен.'));
  });

  it('error path (not_found) renders the org-specific mapped error text', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByText('Загрузить'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Организация не найдена.')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
