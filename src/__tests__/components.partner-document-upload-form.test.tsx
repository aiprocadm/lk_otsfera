// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { uploadPartnerDocument } = vi.hoisted(() => ({ uploadPartnerDocument: vi.fn() }));
vi.mock('@/server-actions/partner/documents', () => ({ uploadPartnerDocument }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

/**
 * jsdom's native FormData construction (used internally by React 19's
 * `<form action={fn}>`) reads a file input's selected files via its own
 * FileList impl, not the public `HTMLInputElement.files` getter/setter —
 * see components.organization-document-upload-form.test.tsx for the full
 * rationale (same helper, copied per project convention: sibling upload
 * forms each carry their own copy rather than sharing a test util).
 */
function pickFile(input: HTMLInputElement, file: File): void {
  const implSymbol = Object.getOwnPropertySymbols(file)[0];
  const fileImpl = (file as any)[implSymbol];
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0];
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  flImpl.push(fileImpl);
  fireEvent.change(input);
}

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

describe('PartnerDocumentUploadForm (interactive)', () => {
  beforeEach(() => {
    uploadPartnerDocument.mockReset();
    toastSuccess.mockClear();
    refresh.mockClear();
  });

  it('changing the doc-type select updates the selected value', () => {
    render(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('other');
    fireEvent.change(select, { target: { value: 'act' } });
    expect(select.value).toBe('act');
  });

  it('success path: submits with a file, toasts with its name, clears the file input and refreshes', async () => {
    uploadPartnerDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    render(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('act.pdf'));

    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «act.pdf» отправлен менеджеру.'));
    expect(uploadPartnerDocument).toHaveBeenCalled();
    const sentFormData = uploadPartnerDocument.mock.calls[0][0] as FormData;
    expect(sentFormData.get('orderId')).toBe('o1');
    expect(sentFormData.get('docType')).toBe('other');
    expect(refresh).toHaveBeenCalled();
    expect(fileInput.value).toBe('');
  });

  it('submits with no file selected (lastFileNameRef falls back to empty string)', async () => {
    uploadPartnerDocument.mockResolvedValue({ ok: true, documentId: 'd2' });
    render(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    fireEvent.click(screen.getByText('Отправить'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «» отправлен менеджеру.'));
  });

  it('error path renders the alert with the resolved error text and does not toast', async () => {
    uploadPartnerDocument.mockResolvedValue({ ok: false, error: 'too_large' });
    render(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    fireEvent.click(screen.getByText('Отправить'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the pending label and disables the file input/select while submitting', async () => {
    let resolveUpload!: (v: { ok: true; documentId: string }) => void;
    uploadPartnerDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      })
    );
    render(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    fireEvent.click(screen.getByText('Отправить'));

    expect(await screen.findByText('Отправляю…')).toBeTruthy();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);

    resolveUpload({ ok: true, documentId: 'd3' });
    await waitFor(() => expect(screen.getByText('Отправить')).toBeTruthy());
  });
});
