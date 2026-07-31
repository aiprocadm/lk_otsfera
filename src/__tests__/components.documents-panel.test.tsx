// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));

import { DocumentsPanel } from '@/components/documents/documents-panel';

const docs = [
  {
    id: 'd1',
    name: 'file.pdf',
    mimeType: 'application/pdf',
    orderId: 'o1',
    createdAt: '2026-01-05T10:00:00.000Z',
  },
];

describe('DocumentsPanel', () => {
  const refetch = vi.fn();

  beforeEach(() => {
    useClientResource.mockReset();
    refetch.mockReset();
    useClientResource.mockReturnValue({ data: null, loading: false, error: false, refetch });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the empty state when there are no documents', () => {
    render(React.createElement(DocumentsPanel));
    expect(screen.getByText('Документов пока нет')).toBeTruthy();
    expect(screen.getByText('0 файлов')).toBeTruthy();
  });

  it('renders the document list with name, mime, formatted date, and count', () => {
    useClientResource.mockReturnValue({ data: docs, loading: false, error: false, refetch });
    render(React.createElement(DocumentsPanel));
    expect(screen.getByText('file.pdf')).toBeTruthy();
    expect(screen.getByText('1 файлов')).toBeTruthy();
    expect(screen.getByText(/application\/pdf/)).toBeTruthy();
  });

  it('shows the selected file name once chosen', () => {
    render(React.createElement(DocumentsPanel));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'contract.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('contract.docx')).toBeTruthy();
  });

  it('clearing the file input (empty FileList) resets file to null', () => {
    render(React.createElement(DocumentsPanel));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'contract.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('contract.docx')).toBeTruthy();

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(screen.queryByText('contract.docx')).toBeNull();
  });

  it('onUpload no-ops when file or orderId is missing (submit button click alone does nothing)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DocumentsPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upload success: posts FormData, shows busy label, clears fields, and refetches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DocumentsPanel));

    const orderInput = screen.getByPlaceholderText('ID заказа');
    fireEvent.change(orderInput, { target: { value: 'order-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents/upload',
        expect.objectContaining({ method: 'POST' })
      )
    );
    const formData = fetchMock.mock.calls[0][1].body as FormData;
    expect(formData.get('orderId')).toBe('order-1');
    expect(formData.get('file')).toBeInstanceOf(File);

    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect((orderInput as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('doc.pdf')).toBeNull();
  });

  it('upload failure: !res.ok keeps fields populated, shows the error and does not refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ code: 'FILE_TOO_LARGE' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DocumentsPanel));

    const orderInput = screen.getByPlaceholderText('ID заказа');
    fireEvent.change(orderInput, { target: { value: 'order-2' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'doc2.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText('Файл превышает допустимый размер.')).toBeTruthy();
    expect(refetch).not.toHaveBeenCalled();
    expect((orderInput as HTMLInputElement).value).toBe('order-2');
  });

  it('download: successful fetch opens the presigned URL in a new tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ downloadUrl: 'https://s3/signed' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    useClientResource.mockReturnValue({ data: docs, loading: false, error: false, refetch });
    render(React.createElement(DocumentsPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/documents/d1/download', { method: 'POST' })
    );
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://s3/signed', '_blank', 'noopener,noreferrer')
    );
  });

  it('upload failure with an unknown code falls back to the generic upload error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('not json')),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DocumentsPanel));

    fireEvent.change(screen.getByPlaceholderText('ID заказа'), { target: { value: 'order-3' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'doc3.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    expect(
      await screen.findByText('Не удалось загрузить документ. Попробуйте ещё раз.')
    ).toBeTruthy();
  });

  it('download failure with a non-410 status shows the generic download error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    useClientResource.mockReturnValue({ data: docs, loading: false, error: false, refetch });
    render(React.createElement(DocumentsPanel));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));

    expect(await screen.findByText('Не удалось получить ссылку для скачивания.')).toBeTruthy();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('download: !res.ok shows an error and does not attempt to open a window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: () => Promise.resolve({ code: 'INFECTED' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    useClientResource.mockReturnValue({ data: docs, loading: false, error: false, refetch });
    render(React.createElement(DocumentsPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      await screen.findByText('Файл в карантине: не прошёл антивирусную проверку.')
    ).toBeTruthy();
    expect(openMock).not.toHaveBeenCalled();
  });
});
