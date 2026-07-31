// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CertificateDownloadButton } from '@/components/enrollment/certificate-download-button';

describe('CertificateDownloadButton', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('успех: POST на /api/documents/{id}/download и window.open(downloadUrl)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ downloadUrl: 'https://s3.example/presigned' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CertificateDownloadButton, { documentId: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать удостоверение' }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://s3.example/presigned',
        '_blank',
        'noopener,noreferrer'
      )
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/download', { method: 'POST' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('410 → toast.error про карантин, window.open не вызывается', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));
    render(React.createElement(CertificateDownloadButton, { documentId: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать удостоверение' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Файл в карантине: не прошёл антивирусную проверку.')
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('прочие не-ok статусы → toast.error про ссылку', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(React.createElement(CertificateDownloadButton, { documentId: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать удостоверение' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось получить ссылку для скачивания.')
    );
  });

  it('сетевой сбой (fetch reject) → «Сетевая ошибка»', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(React.createElement(CertificateDownloadButton, { documentId: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать удостоверение' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('busy-состояние: пока запрос в полёте — «Готовим ссылку…» и disabled, после — снова активна', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    render(React.createElement(CertificateDownloadButton, { documentId: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скачать удостоверение' }));

    const busyButton = await screen.findByRole('button', { name: 'Готовим ссылку…' });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);

    resolveFetch({ ok: true, json: async () => ({ downloadUrl: 'https://s3.example/x' }) });
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const idleButton = screen.getByRole('button', { name: 'Скачать удостоверение' });
    expect((idleButton as HTMLButtonElement).disabled).toBe(false);
  });
});
