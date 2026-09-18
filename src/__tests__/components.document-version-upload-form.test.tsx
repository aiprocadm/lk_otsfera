// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { DocumentVersionUploadForm } from '@/components/documents/document-version-upload-form';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';

/**
 * Форма «Загрузить новую версию» (`У-251`).
 *
 * Проверяется не разметка ради разметки, а три вещи: форма отправляет ровно те
 * поля, которые дал ей кабинет (иначе файл ляжет не туда), в теле есть ссылка
 * на заменяемый документ, и пустой или слишком большой файл до сервера не
 * доходит.
 *
 * Трюк с `FileList` — тот же, что в остальных тестах форм загрузки: у jsdom нет
 * `DataTransfer`, а `FormData` читает список файлов мимо публичного геттера.
 */
function makeFile(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

function pushToFileList(input: HTMLInputElement, file: File): void {
  const implSymbol = Object.getOwnPropertySymbols(file)[0] as symbol;
  const fileImpl = (file as any)[implSymbol];
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0] as symbol;
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  flImpl.push(fileImpl);
  fireEvent.change(input);
}

function pickFile(input: HTMLInputElement, file: File): void {
  pushToFileList(input, file);
}

function pickOversizedFile(input: HTMLInputElement, sizeBytes: number): void {
  const file = makeFile('huge.pdf');
  const implSymbol = Object.getOwnPropertySymbols(file)[0] as symbol;
  Object.defineProperty((file as any)[implSymbol], 'size', { value: sizeBytes });
  pushToFileList(input, file);
}

const PROPS = {
  url: '/api/manager/documents/ord1/upload',
  fields: { docType: 'invoice', recipient: 'organization' },
  documentId: 'doc1',
  currentVersion: 2,
};

function renderForm() {
  return render(React.createElement(DocumentVersionUploadForm, PROPS));
}

describe('DocumentVersionUploadForm — разметка', () => {
  it('говорит, какую версию заменяет, и предлагает главное действие', () => {
    const html = renderToString(React.createElement(DocumentVersionUploadForm, PROPS));
    expect(html).toContain('Новая версия документа');
    expect(html).toContain('Загрузить новую версию');
    expect(html).toContain('Файл заменит действующую версию 2');
    expect(html).toContain('type="file"');
    expect(html).toContain(`${DEFAULT_MAX_FILE_SIZE_MB}`);
  });
});

describe('DocumentVersionUploadForm — поведение', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    vi.restoreAllMocks();
  });

  it('файл не выбран — сервер не беспокоим', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    fireEvent.click(screen.getByText('Загрузить новую версию'));

    await waitFor(() => expect(screen.getByText('Файл не выбран.')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('файл больше предела — отказ до отправки', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickOversizedFile(input, (DEFAULT_MAX_FILE_SIZE_MB + 1) * 1024 * 1024);
    fireEvent.click(screen.getByText('Загрузить новую версию'));

    await waitFor(() =>
      expect(
        screen.getByText(
          `Файл больше предела в ${DEFAULT_MAX_FILE_SIZE_MB} МБ — выберите поменьше.`
        )
      ).toBeTruthy()
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('успех: уходят поля кабинета и ссылка на заменяемый документ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(input, makeFile('schet-v3.pdf'));
    fireEvent.click(screen.getByText('Загрузить новую версию'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Загружена версия 3. Прежняя помечена как заменённая.'
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/manager/documents/ord1/upload',
      expect.objectContaining({ method: 'POST' })
    );
    const sent = fetchMock.mock.calls[0]![1].body as FormData;
    expect(sent.get('replacesDocumentId')).toBe('doc1');
    expect(sent.get('docType')).toBe('invoice');
    expect(sent.get('recipient')).toBe('organization');
    expect((sent.get('file') as File).name).toBe('schet-v3.pdf');
    expect(input.value).toBe('');
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('отказ сервера показывается по-русски и не радует человека успехом', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'mismatch' }) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(input, makeFile('act.pdf'));
    fireEvent.click(screen.getByText('Загрузить новую версию'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(
      screen.getByText(
        'Это файл другого типа или другого контрагента — загрузите его как отдельный документ.'
      )
    ).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
