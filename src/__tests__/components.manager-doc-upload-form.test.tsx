// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { ManagerDocUploadForm } from '@/components/manager/manager-doc-upload-form';

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

describe('ManagerDocUploadForm (SSR structure)', () => {
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

describe('ManagerDocUploadForm (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    vi.restoreAllMocks();
  });

  it('empty file picker: submit shows the local guard error and does not fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Файл не выбран.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('changing docType to commission_statement auto-switches recipient to partner', () => {
    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    const selects = document.querySelectorAll('select');
    const typeSelect = selects[0] as HTMLSelectElement;
    const recipientSelect = selects[1] as HTMLSelectElement;

    fireEvent.change(typeSelect, { target: { value: 'commission_statement' } });
    expect(recipientSelect.value).toBe('partner');
  });

  it('changing docType away from commission_statement resets recipient to organization', () => {
    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    const selects = document.querySelectorAll('select');
    const typeSelect = selects[0] as HTMLSelectElement;
    const recipientSelect = selects[1] as HTMLSelectElement;

    fireEvent.change(typeSelect, { target: { value: 'commission_statement' } });
    expect(recipientSelect.value).toBe('partner');
    fireEvent.change(typeSelect, { target: { value: 'contract' } });
    expect(recipientSelect.value).toBe('organization');
  });

  it('manually changing the recipient select updates its value', () => {
    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    const selects = document.querySelectorAll('select');
    const recipientSelect = selects[1] as HTMLSelectElement;
    fireEvent.change(recipientSelect, { target: { value: 'partner' } });
    expect(recipientSelect.value).toBe('partner');
  });

  it('success path: picking a file and submitting POSTs, toasts, clears input, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('act.pdf'));

    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Документ «act.pdf» загружен.'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/manager/documents/o1/upload',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fileInput.value).toBe('');
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('server error response: renders the mapped alert text (not the local guard message)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'too_large' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('big.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Файл не выбран.')).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('submitting again after the local guard error clears it once a file is chosen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    fireEvent.click(screen.getByText('Загрузить'));
    await waitFor(() => expect(screen.getByText('Файл не выбран.')).toBeTruthy());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.queryByText('Файл не выбран.')).toBeNull());
    vi.unstubAllGlobals();
  });
});
