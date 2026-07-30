// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ClientRequestAttachmentDropzone } from '@/components/client-requests/client-request-attachment-dropzone';
import {
  ClientRequestAttachmentsList,
  type ClientRequestAttachmentRowVM
} from '@/components/client-requests/client-request-attachments-list';

function pdfFile(name = 'doc.pdf', content = 'pdf-bytes'): File {
  return new File([content], name, { type: 'application/pdf' });
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function attachment(
  overrides: Partial<ClientRequestAttachmentRowVM> = {}
): ClientRequestAttachmentRowVM {
  return {
    id: 'a1',
    name: 'договор.pdf',
    size: 2048,
    mimeType: 'application/pdf',
    createdAt: '2024-01-16T09:00:00Z',
    createdByUserName: 'Партнёр 1',
    ...overrides
  };
}

describe('ClientRequestAttachmentDropzone', () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('успешная загрузка через выбор файла: multipart POST на правильный url + refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/client-requests/req-1/attachments');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get('file') as File;
    expect(sent.name).toBe('doc.pdf');
    // Ошибок не показано
    expect(document.body.textContent).not.toContain('Ошибка');
  });

  it('drag-and-drop файла тоже загружает на тот же url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-2' }));

    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [pdfFile('drop.pdf')] } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/client-requests/req-2/attachments',
        expect.objectContaining({ method: 'POST' })
      )
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('413 от сервера → «Файл больше 200 МБ» (дефолтный лимит), refresh не зовётся', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413 }));
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(screen.getByText('Файл больше 200 МБ')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('415 → «Не поддерживаемый формат»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 415 }));
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(screen.getByText('Не поддерживаемый формат')).toBeTruthy());
  });

  it('403 → «Обращение не редактируется»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(screen.getByText('Обращение не редактируется')).toBeTruthy());
  });

  it('прочие ошибки: error из json, а при неразбираемом json — статус-код', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'infected' }) })
    );
    const { unmount } = render(
      React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' })
    );
    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });
    await waitFor(() => expect(screen.getByText('infected')).toBeTruthy());
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        }
      })
    );
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));
    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });
    await waitFor(() => expect(screen.getByText('Ошибка загрузки: 500')).toBeTruthy());
  });

  it('клиентская проверка типа: недопустимый MIME отклоняется без запроса', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    const bad = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput(), { target: { files: [bad] } });

    await waitFor(() => expect(screen.getByText('Поддерживаются PDF, JPEG, PNG, DOCX, XLSX')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('клиентская проверка размера: файл больше лимита отклоняется без запроса', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1', maxSizeMb: 1 }));

    const big = pdfFile('big.pdf', 'x'.repeat(1024 * 1024 + 1));
    fireEvent.change(fileInput(), { target: { files: [big] } });

    await waitFor(() => expect(screen.getByText('Файл больше 1 МБ')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('сетевой сбой → сообщение ошибки из исключения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('соединение прервано')));
    render(React.createElement(ClientRequestAttachmentDropzone, { requestId: 'req-1' }));

    fireEvent.change(fileInput(), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(screen.getByText('соединение прервано')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('ClientRequestAttachmentsList', () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('пустой список → «Пока нет вложений»', () => {
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [] }));
    expect(screen.getByText('Пока нет вложений')).toBeTruthy();
  });

  it('строка: имя, размер, автор и иконка типа', () => {
    render(
      React.createElement(ClientRequestAttachmentsList, {
        requestId: 'req-1',
        rows: [
          attachment(),
          attachment({ id: 'a2', name: 'фото.png', mimeType: 'image/png', size: 5 * 1024 * 1024 })
        ]
      })
    );
    expect(screen.getByText('договор.pdf')).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText(/2\.0 КБ/)).toBeTruthy();
    expect(screen.getAllByText(/Партнёр 1/).length).toBe(2);
    expect(screen.getByText('фото.png')).toBeTruthy();
    expect(screen.getByText('IMG')).toBeTruthy();
    expect(screen.getByText(/5\.0 МБ/)).toBeTruthy();
  });

  it('размеры и типы файлов подписываются по-человечески во всех диапазонах', () => {
    // Размер показывается в байтах, килобайтах или мегабайтах — по величине.
    // Тип берётся из MIME: у офисных форматов он длинный и нечитаемый, поэтому
    // рядом стоит короткая метка. Незнакомый формат — нейтральное «FILE».
    render(
      React.createElement(ClientRequestAttachmentsList, {
        requestId: 'req-1',
        rows: [
          attachment({ id: 'b1', name: 'записка.txt', mimeType: 'text/plain', size: 512 }),
          attachment({
            id: 'b2',
            name: 'договор.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 3000
          }),
          attachment({
            id: 'b3',
            name: 'смета.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 4000
          }),
          attachment({ id: 'b4', name: 'скан.jpg', mimeType: 'image/jpeg', size: 6000 })
        ]
      })
    );
    expect(screen.getByText(/512 Б/)).toBeTruthy();
    expect(screen.getByText('FILE')).toBeTruthy(); // text/plain — вне списка
    expect(screen.getByText('DOC')).toBeTruthy();
    expect(screen.getByText('XLS')).toBeTruthy();
    expect(screen.getByText('IMG')).toBeTruthy();
  });

  it('сбой скачивания не-Error значением показывается сообщением «Ошибка сети»', async () => {
    // fetch может отвергнуть промис не-Error значением (обрыв соединения в
    // некоторых окружениях). Пользователю нужно увидеть причину, а не пустоту.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('connection reset'));
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));
    fireEvent.click(screen.getByText('договор.pdf'));
    await waitFor(() => expect(screen.getByText('Ошибка сети')).toBeTruthy());
  });

  it('скачивание: POST download-роут → window.open(downloadUrl)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ downloadUrl: 'https://s3.example/presigned-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));

    fireEvent.click(screen.getByText('договор.pdf'));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://s3.example/presigned-1', '_blank', 'noopener')
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/client-requests/req-1/attachments/a1/download',
      { method: 'POST' }
    );
  });

  it('410 (карантин) → «Файл помещён в карантин антивирусом», window.open не зовётся', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));

    fireEvent.click(screen.getByText('договор.pdf'));

    await waitFor(() => expect(screen.getByText('Файл помещён в карантин антивирусом')).toBeTruthy());
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('infected-ветка: error из json ответа показывается как текст ошибки', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'infected' }) })
    );
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));

    fireEvent.click(screen.getByText('договор.pdf'));

    await waitFor(() => expect(screen.getByText('infected')).toBeTruthy());
  });

  it('неразбираемый json ошибки → «Ошибка скачивания: <код>»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        }
      })
    );
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));

    fireEvent.click(screen.getByText('договор.pdf'));

    await waitFor(() => expect(screen.getByText('Ошибка скачивания: 500')).toBeTruthy());
  });

  it('сетевой сбой при скачивании → текст исключения, кнопка снова активна', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('обрыв сети')));
    render(React.createElement(ClientRequestAttachmentsList, { requestId: 'req-1', rows: [attachment()] }));

    fireEvent.click(screen.getByText('договор.pdf'));

    await waitFor(() => expect(screen.getByText('обрыв сети')).toBeTruthy());
    const btn = screen.getByText('договор.pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
