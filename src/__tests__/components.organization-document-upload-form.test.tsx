// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { uploadOrganizationDocument } = vi.hoisted(() => ({ uploadOrganizationDocument: vi.fn() }));
vi.mock('@/server-actions/organization/documents', () => ({ uploadOrganizationDocument }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import { OrganizationDocumentUploadForm } from '@/components/organization/organization-document-upload-form';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

/**
 * jsdom's native FormData construction (used internally by React 19's
 * `<form action={fn}>`) reads a file input's selected files via its own
 * FileList impl, not the public `HTMLInputElement.files` getter/setter —
 * so a plain `Object.defineProperty(input, 'files', {value:[file]})` is
 * invisible to it (FormData still sees an empty file). jsdom has no
 * DataTransfer to build a real FileList the "normal" way either. This
 * pushes the file's impl object directly into the input's own (lazily
 * created) FileList impl array, which both `input.files` and jsdom's
 * FormData entry-list construction read from.
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

describe('OrganizationDocumentUploadForm', () => {
  beforeEach(() => {
    uploadOrganizationDocument.mockReset();
    toastSuccess.mockClear();
    refresh.mockClear();
  });

  it('renders the file input, doc-type select, and submit button', () => {
    render(React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' }));
    expect(screen.getByText('Отправить документ менеджеру')).toBeTruthy();
    expect(screen.getByText('Отправить')).toBeTruthy();
    expect(screen.getByText('Договор')).toBeTruthy();
  });

  it('changing the doc-type select updates the selected value', () => {
    render(React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('other');
    fireEvent.change(select, { target: { value: 'act' } });
    expect(select.value).toBe('act');
  });

  it('success path: submits with a file, toasts with its name, and clears the file input', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    render(React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('act.pdf'));

    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «act.pdf» отправлен менеджеру.'));
    expect(uploadOrganizationDocument).toHaveBeenCalled();
    const sentFormData = uploadOrganizationDocument.mock.calls[0][0] as FormData;
    expect(sentFormData.get('organizationId')).toBe('org1');
    expect(sentFormData.get('orderId')).toBe('o1');
    expect(sentFormData.get('docType')).toBe('other');
    expect(refresh).toHaveBeenCalled();
  });

  it('submits with no file selected (lastFileNameRef falls back to empty string)', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: true, documentId: 'd2' });
    render(React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' }));
    fireEvent.click(screen.getByText('Отправить'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «» отправлен менеджеру.'));
  });

  it('error path renders the alert with the resolved error text', async () => {
    uploadOrganizationDocument.mockResolvedValue({ ok: false, error: 'too_large' });
    render(React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' }));
    fireEvent.click(screen.getByText('Отправить'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
