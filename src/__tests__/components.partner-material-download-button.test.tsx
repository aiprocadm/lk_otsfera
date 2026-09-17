// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: vi.fn() } }));

import { PartnerMaterialDownloadButton } from '@/components/partner/partner-material-download-button';

/** «Скачать» материал (`У-237`). */
const fetchMock = vi.fn();
const openMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('open', openMock);
});
afterEach(() => vi.unstubAllGlobals());

function click() {
  render(React.createElement(PartnerMaterialDownloadButton, { materialId: 'm1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
}

describe('PartnerMaterialDownloadButton', () => {
  it('успех: POST на роут материалов и открытие подписанной ссылки', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ downloadUrl: 'https://s3/x' }) });
    click();
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://s3/x', '_blank', 'noopener,noreferrer')
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/partner/materials/m1/download', {
      method: 'POST',
    });
  });

  it('ошибка сервера — тост; кривой JSON не роняет', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('bad');
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
