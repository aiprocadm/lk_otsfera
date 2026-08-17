// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { OrganizationOrderLessUploadForm } from '@/components/organization/organization-order-less-upload-form';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';

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

describe('OrganizationOrderLessUploadForm (SSR structure)', () => {
  it('renders the heading, submit button and the config-driven size hint', () => {
    const html = renderToString(
      React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' })
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('Загрузить общий документ');
    // SSR вставляет `<!-- -->` между JSX-вставками — сверяем куски по отдельности.
    expect(html).toContain('Максимум');
    expect(html).toContain(String(DEFAULT_MAX_FILE_SIZE_MB));
  });
});

describe('OrganizationOrderLessUploadForm (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    vi.restoreAllMocks();
  });

  it('changing the doc-type select updates the selected value', () => {
    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('other');
    fireEvent.change(select, { target: { value: 'report' } });
    expect(select.value).toBe('report');
  });

  it('empty file picker: submit shows the local guard error and does not fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Файл не выбран.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('over-limit file: submit shows the size guard error and does not fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickOversizedFile(fileInput, 'huge.pdf', (DEFAULT_MAX_FILE_SIZE_MB + 1) * 1024 * 1024);
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(
      screen.getByText(`Файл больше предела в ${DEFAULT_MAX_FILE_SIZE_MB} МБ — выберите поменьше.`)
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('success path: POSTs FormData without orderId (order-less branch), toasts, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('report.pdf'));

    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Документ «report.pdf» загружен.')
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/organization/documents/upload',
      expect.objectContaining({ method: 'POST' })
    );
    const sent = fetchMock.mock.calls[0]![1].body as FormData;
    expect(sent.get('organizationId')).toBe('org1');
    expect(sent.get('orderId')).toBeNull();
    expect(sent.get('docType')).toBe('other');
    expect((sent.get('file') as File).name).toBe('report.pdf');
    expect(fileInput.value).toBe('');
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('not_found from the API renders the form-local text «Организация не найдена.»', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Организация не найдена.')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('submitting again after the local guard error clears it once a file is chosen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(OrganizationOrderLessUploadForm, { organizationId: 'org1' }));
    fireEvent.click(screen.getByText('Загрузить'));
    await waitFor(() => expect(screen.getByText('Файл не выбран.')).toBeTruthy());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(fileInput, makeFile('doc.pdf'));
    fireEvent.click(screen.getByText('Загрузить'));

    await waitFor(() => expect(screen.queryByText('Файл не выбран.')).toBeNull());
    vi.unstubAllGlobals();
  });
});
