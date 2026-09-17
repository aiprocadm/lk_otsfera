// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));

import { PartnerMaterialUploadForm } from '@/components/partner-materials/partner-material-upload-form';

/** Форма нового материала (`У-237`): файл ИЛИ ссылка, fetch на файловый роут, русские ошибки. */
const fetchMock = vi.fn();
const onDone = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, id: 'm1' }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  render(React.createElement(PartnerMaterialUploadForm, { companyId: 'c1', onDone, onCancel }));
}

function fillTitle(v = 'Прайс') {
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: v } });
}

describe('PartnerMaterialUploadForm', () => {
  it('режим «Файл»: форма уходит multipart с companyId, файлом и пустой ссылкой; успех — тост и onDone', async () => {
    mount();
    fillTitle();
    const file = new File(['%PDF-1.4'], 'p.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Файл', { selector: 'input[type="file"]' }), {
      target: { files: [file] },
    });
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/partner-materials');
    const fd = init.body as FormData;
    expect(fd.get('companyId')).toBe('c1');
    expect(fd.get('title')).toBe('Прайс');
    expect(fd.get('externalUrl')).toBe('');
    expect(fd.get('file')).toBeInstanceOf(File);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('режим «Ссылка»: файл не отправляется, ссылка — да', async () => {
    mount();
    fillTitle('Каталог');
    fireEvent.click(screen.getByLabelText('Ссылка', { selector: 'input[type="radio"]' }));
    fireEvent.change(screen.getByLabelText('Ссылка', { selector: 'input[type="url"]' }), {
      target: { value: 'https://x.ru/c' },
    });
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fd = fetchMock.mock.calls[0][1].body as FormData;
    expect(fd.get('externalUrl')).toBe('https://x.ru/c');
    expect(fd.get('file')).toBeNull();
  });

  it('ошибки: тексты валидации сервера, размер, неизвестный код, сеть; «Отмена»', async () => {
    mount();
    fillTitle();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'validation', messages: ['Приложите файл или укажите ссылку.'] }),
    });
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Приложите файл или укажите ссылку.')
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({ error: 'too_large' }),
    });
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Файл больше'))
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no json');
      },
    });
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(3));

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.submit(screen.getByTestId('partner-material-form'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
