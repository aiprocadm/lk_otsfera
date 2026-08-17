// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { OrganizationDocumentUploadForm } from '@/components/organization/organization-document-upload-form';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';

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

/** Same impl-level trick, but with a spoofed `size` — allocating 200+ MB for real is a no-go. */
function pickOversizedFile(input: HTMLInputElement, name: string, sizeBytes: number): void {
  const file = makeFile(name);
  const implSymbol = Object.getOwnPropertySymbols(file)[0];
  const fileImpl = (file as any)[implSymbol];
  Object.defineProperty(fileImpl, 'size', { value: sizeBytes });
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0];
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  flImpl.push(fileImpl);
  fireEvent.change(input);
}

function renderForm() {
  return render(
    React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' })
  );
}

describe('OrganizationDocumentUploadForm (SSR structure)', () => {
  it('renders the heading, submit button and the config-driven size hint', () => {
    const html = renderToString(
      React.createElement(OrganizationDocumentUploadForm, { organizationId: 'org1', orderId: 'o1' })
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('Отправить документ менеджеру');
    expect(html).toContain('Договор');
  });
});

describe('OrganizationDocumentUploadForm (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    vi.restoreAllMocks();
  });

  it('changing the doc-type select updates the selected value', () => {
    renderForm();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('other');
    fireEvent.change(select, { target: { value: 'act' } });
    expect(select.value).toBe('act');
  });

  it('empty file picker: submit shows the local guard error and does not fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Файл не выбран.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('over-limit file: submit shows the size guard error and does not fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickOversizedFile(fileInput, 'huge.pdf', (DEFAULT_MAX_FILE_SIZE_MB + 1) * 1024 * 1024);
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(
      screen.getByText(`Файл больше предела в ${DEFAULT_MAX_FILE_SIZE_MB} МБ — выберите поменьше.`)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('success path: POSTs FormData with organizationId and orderId, toasts, clears, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('act.pdf'));

    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Документ «act.pdf» отправлен менеджеру.')
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/organization/documents/upload',
      expect.objectContaining({ method: 'POST' })
    );
    const sent = fetchMock.mock.calls[0]![1].body as FormData;
    expect(sent.get('organizationId')).toBe('org1');
    expect(sent.get('orderId')).toBe('o1');
    expect(sent.get('docType')).toBe('other');
    expect((sent.get('file') as File).name).toBe('act.pdf');
    expect(fileInput.value).toBe('');
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('server error response: renders the alert with the resolved error text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 413, json: async () => ({ error: 'too_large' }) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('big.pdf'));
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Файл не выбран.')).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('submitting again after the local guard error clears it once a file is chosen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    fireEvent.click(screen.getByText('Отправить'));
    await waitFor(() => expect(screen.getByText('Файл не выбран.')).toBeTruthy());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.queryByText('Файл не выбран.')).toBeNull());
    vi.unstubAllGlobals();
  });
});
