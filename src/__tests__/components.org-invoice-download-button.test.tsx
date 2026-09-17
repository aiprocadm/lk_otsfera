// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: vi.fn() } }));

import { OrgInvoiceDownloadButton } from '@/components/organization/org-invoice-download-button';

/** «Скачать» у счёта (`У-235`): тот же роут, что у документов заказчика. */

const fetchMock = vi.fn();
const openMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('open', openMock);
});
afterEach(() => vi.unstubAllGlobals());

function click() {
  render(React.createElement(OrgInvoiceDownloadButton, { documentId: 'd1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
}

describe('OrgInvoiceDownloadButton', () => {
  it('успех: POST на роут документов организации и открытие подписанной ссылки', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ downloadUrl: 'https://s3/x' }),
    });
    click();
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://s3/x', '_blank', 'noopener,noreferrer')
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/documents/d1/download', {
      method: 'POST',
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('410 — файл не прошёл антивирус', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ error: 'infected' }),
    });
    click();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('антивирус'))
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it('прочие ошибки — общая подсказка; кривой JSON не роняет', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('bad json');
      },
    });
    click();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('попробуйте ещё раз'))
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it('сетевая ошибка — тост, кнопка снова активна', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    click();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    expect((screen.getByRole('button', { name: 'Скачать' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});
