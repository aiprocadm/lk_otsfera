// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ZipDownloadButton } from '@/components/documents/zip-download-button';
import { zipSkippedSummaryRu } from '@/lib/documents/zipSummary';

/**
 * Кнопка «Скачать выбранные (ZIP)» (`У-252`).
 *
 * Главное, что здесь проверяется, — человек узнаёт правду: сколько бумаг
 * уехало и сколько не уехало. Ради этого кнопка и качает через `fetch`, а не
 * обычной ссылкой: ссылка проглотила бы ответ молча.
 */
function mockDownloadPlumbing() {
  // jsdom не умеет ни объектных ссылок, ни настоящего клика по `<a download>`:
  // `URL.createObjectURL` там попросту отсутствует, поэтому его не подменяют,
  // а заводят.
  const created: HTMLAnchorElement[] = [];
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:zip';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      (el as HTMLAnchorElement).click = vi.fn();
      created.push(el as HTMLAnchorElement);
    }
    return el;
  });
  return created;
}

function okResponse(headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(['zip']),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

describe('ZipDownloadButton (У-252)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('без выбранных строк кнопка неактивна и никуда не ходит', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ZipDownloadButton ids={[]} />);
    const btn = screen.getByText('Скачать выбранные (ZIP)') as HTMLButtonElement;
    expect(btn.closest('button')?.disabled).toBe(true);
    fireEvent.click(btn);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('успех: файл сохраняется, а в подписи — сколько уехало и что не вошло', async () => {
    const created = mockDownloadPlumbing();
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        'x-documents-count': '3',
        'x-documents-skipped': JSON.stringify({
          noAccess: 2,
          pending: 1,
          infected: 0,
          unavailable: 0,
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ZipDownloadButton ids={['a', 'b']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/zip?ids=a%2Cb');
    const text = toastSuccess.mock.calls[0]![0] as string;
    expect(text).toContain('Архив собран: 3 документов.');
    expect(text).toContain('не включено: 2');
    expect(text).toContain('ожидает проверки: 1');
    expect(created[0]?.click).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('вошло всё — про пропуски молчим', async () => {
    mockDownloadPlumbing();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          'x-documents-count': '2',
          'x-documents-skipped': JSON.stringify({
            noAccess: 0,
            pending: 0,
            infected: 0,
            unavailable: 0,
          }),
        })
      )
    );

    render(<ZipDownloadButton ids={['a', 'b']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0]![0]).toBe('Архив собран: 2 документов.');
    vi.unstubAllGlobals();
  });

  it('битый заголовок пропусков не мешает скачать', async () => {
    mockDownloadPlumbing();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ 'x-documents-count': '1', 'x-documents-skipped': 'не-json' })
        )
    );

    render(<ZipDownloadButton ids={['a']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0]![0]).toBe('Архив собран: 1 документов.');
    vi.unstubAllGlobals();
  });

  it('отказ сервера показывается его же словами', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({
          error: 'too_many_files',
          message: 'Выбрано 80 документов — это больше предела в 50. Снимите лишние галочки.',
        }),
      })
    );

    render(<ZipDownloadButton ids={['a']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toContain('больше предела в 50');
    vi.unstubAllGlobals();
  });

  it('отказ без тела не оставляет человека без ответа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('нет тела');
        },
      })
    );

    render(<ZipDownloadButton ids={['a']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toBe('Не удалось собрать архив. Попробуйте ещё раз.');
    vi.unstubAllGlobals();
  });

  it('сеть отвалилась — говорим об этом, а не молчим', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<ZipDownloadButton ids={['a']} />);
    fireEvent.click(screen.getByText('Скачать выбранные (ZIP)'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toContain('Сетевая ошибка');
    vi.unstubAllGlobals();
  });
});

describe('zipSkippedSummaryRu', () => {
  it('вошло всё — пустая строка, а не «не включено: 0»', () => {
    expect(zipSkippedSummaryRu({ noAccess: 0, pending: 0, infected: 0, unavailable: 0 })).toBe('');
  });

  it('перечисляет только то, что действительно случилось', () => {
    expect(zipSkippedSummaryRu({ noAccess: 1, pending: 0, infected: 2, unavailable: 3 })).toBe(
      'не включено: 1, в карантине: 2, файл недоступен: 3'
    );
  });
});
