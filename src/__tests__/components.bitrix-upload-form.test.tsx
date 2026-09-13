// @vitest-environment jsdom
/**
 * Форма файлов выгрузки Битрикс24 (`У-189` file, этап 2 PR-2): проверка CSV/XLSX
 * по шапке через файловый роут `/api/admin/bitrix/upload` (§11 CLAUDE.md — не
 * server action). Проверяем разметку, pending-состояние, таблицу диагностики
 * (все четыре вида строк), строку итога и русские тексты ошибок.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BitrixUploadForm } from '@/components/bitrix/upload-form';
import { BITRIX_UPLOAD_MAX_FILES, IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import type { BitrixFileDiagnostic } from '@/lib/services/bitrix/column-map';

type UploadedFile = BitrixFileDiagnostic & { key: string | null };

/** Ответ роута в том виде, в каком его читает `buildFetchAction` (ok/status/json). */
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function okJson(body: unknown): FakeResponse {
  return { ok: true, status: 200, json: async () => body };
}
function errJson(status: number, body: unknown): FakeResponse {
  return { ok: false, status, json: async () => body };
}
/** Ответ без тела: `res.json()` бросает — хук падает на синтетический `http_<status>`. */
function errNoBody(status: number): FakeResponse {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

function makeFile(name: string): File {
  return new File(['ID;Название\n1;ООО «Ромашка»\n'], name, { type: 'text/csv' });
}

/**
 * См. components.organization-document-upload-form.test.tsx: публичное
 * `HTMLInputElement.files` не видно построителю FormData внутри jsdom (а именно
 * им React 19 собирает тело для `<form action={fn}>`), DataTransfer в jsdom нет.
 * Поэтому кладём impl-объекты файлов прямо в ленивый FileList самого инпута.
 */
function pickFiles(input: HTMLInputElement, files: File[]): void {
  const fileList = input.files as unknown as File[];
  const flImplSymbol = Object.getOwnPropertySymbols(fileList)[0]!;
  const flImpl = (fileList as any)[flImplSymbol] as unknown[];
  for (const file of files) {
    const implSymbol = Object.getOwnPropertySymbols(file)[0]!;
    flImpl.push((file as any)[implSymbol]);
  }
  fireEvent.change(input);
}

function renderForm() {
  const utils = render(<BitrixUploadForm />);
  const container = utils.container;
  return {
    container,
    input: () => container.querySelector('input[type="file"]') as HTMLInputElement,
    button: () => container.querySelector('button[type="submit"]') as HTMLButtonElement,
    text: () => container.textContent ?? '',
    table: () => container.querySelector('table'),
    rows: () => [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? ''),
    // Обе живые области смонтированы всегда (§9): пустая прячется классом
    // `sr-only`, поэтому проверяем текст и видимость, а не наличие узла.
    alert: () => container.querySelector('[role="alert"]'),
    alertText: () => container.querySelector('[role="alert"]')?.textContent ?? '',
    status: () => container.querySelector('[role="status"]'),
    statusText: () => container.querySelector('[role="status"]')?.textContent ?? '',
    hidden: (el: Element | null | undefined) => el?.className.includes('sr-only') ?? false,
  };
}

/** Выбрать пару файлов и нажать «Проверить файлы». */
function submitWithFiles(ui: ReturnType<typeof renderForm>, names = ['companies.csv']): void {
  pickFiles(ui.input(), names.map(makeFile));
  fireEvent.click(ui.button());
}

/** Четыре вида строк диагностики: две сохранённые (есть `key`), две отклонённые. */
const FOUR_FILES: UploadedFile[] = [
  {
    name: 'companies.csv',
    entity: 'company',
    candidate: 'company',
    rows: 5,
    unmatchedHeaders: [],
    missing: [],
    key: 'bitrix-import/uploads/x/1-a.csv',
  },
  {
    name: 'contacts.csv',
    entity: 'contact',
    candidate: 'contact',
    rows: 12,
    unmatchedHeaders: ['Лишняя'],
    missing: [],
    key: 'bitrix-import/uploads/x/2-b.csv',
  },
  {
    name: 'deals.csv',
    entity: null,
    candidate: 'deal',
    rows: 7,
    unmatchedHeaders: ['Воронка'],
    missing: ['Стадия сделки'],
    key: null,
  },
  {
    name: 'unknown.xlsx',
    entity: null,
    candidate: null,
    rows: 3,
    unmatchedHeaders: ['Колонка A'],
    missing: [],
    key: null,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BitrixUploadForm — разметка', () => {
  it('заголовок, объяснение, файловый инпут с accept, подсказка о лимитах и кнопка; таблицы до отправки нет', () => {
    const ui = renderForm();

    // «Что здесь делают» (§15): заголовок + одна строка объяснения.
    const heading = ui.container.querySelector('h2');
    expect(heading?.textContent).toBe('Файлы выгрузки');
    expect(ui.container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      heading?.getAttribute('id')
    );
    expect(ui.text()).toContain('Выгрузите из Битрикс24 списки компаний, контактов, лидов');
    expect(ui.text()).toContain('определится по шапке');

    const input = ui.input();
    expect(input.getAttribute('name')).toBe('files');
    expect(input.multiple).toBe(true);
    expect(input.required).toBe(true);
    const accept = input.getAttribute('accept') ?? '';
    expect(accept).toContain('.csv');
    expect(accept).toContain('.xlsx');
    // Подпись инпута привязана к нему по id, а не «рядом лежит» (доступность).
    expect(ui.container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(
      'Файлы CSV или XLSX'
    );

    // Цифры лимитов — из единственного источника правды, а не из головы.
    expect(ui.text()).toContain(
      `До ${BITRIX_UPLOAD_MAX_FILES} файлов за раз, каждый до ${IMPORT_MAX_FILE_MB} МБ.`
    );

    expect(ui.button().textContent).toBe('Проверить файлы');
    expect(ui.button().disabled).toBe(false);
    expect(ui.table()).toBeNull();
    // Живые области на месте, но пусты и скрыты — так их услышит скринридер.
    expect(ui.alertText()).toBe('');
    expect(ui.hidden(ui.alert())).toBe(true);
    expect(ui.statusText()).toBe('');
    expect(ui.hidden(ui.status())).toBe(true);
  });
});

describe('BitrixUploadForm — отправка', () => {
  it('шлёт FormData с файлами POST-ом на /api/admin/bitrix/upload', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, files: [] }));
    const ui = renderForm();

    submitWithFiles(ui, ['companies.csv', 'contacts.csv']);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/bitrix/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).getAll('files') as File[];
    expect(sent.map((f) => f.name)).toEqual(['companies.csv', 'contacts.csv']);
    // Multipart идёт без ручного content-type — boundary проставляет браузер.
    expect(init.headers).toBeUndefined();
  });

  it('пока ответ не пришёл — кнопка заблокирована и говорит «Проверяем…»', async () => {
    let release: ((res: FakeResponse) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<FakeResponse>((resolve) => {
          release = resolve;
        })
    );
    const ui = renderForm();

    submitWithFiles(ui);

    // Ответ добиваем в finally: незавершённый переход React переживает тест и
    // подвешивает соседние — один упавший тест иначе красит полфайла.
    try {
      await waitFor(() => expect(ui.button().textContent).toBe('Проверяем…'));
      expect(ui.button().disabled).toBe(true);
    } finally {
      await act(async () => {
        release?.(okJson({ ok: true, files: FOUR_FILES }));
      });
    }

    await waitFor(() => expect(ui.button().textContent).toBe('Проверить файлы'));
    expect(ui.button().disabled).toBe(false);
  });
});

describe('BitrixUploadForm — таблица диагностики', () => {
  it('четыре вида строк: распознан, распознан с лишними колонками, кандидат и полная неизвестность', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, files: FOUR_FILES }));
    const ui = renderForm();

    submitWithFiles(ui);

    await waitFor(() => expect(ui.table()).not.toBeNull());

    const headers = [...ui.container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Файл', 'Сущность', 'Строк', 'Колонки']);

    const rows = ui.rows();
    expect(rows).toHaveLength(4);

    // 1. Распознан целиком.
    expect(rows[0]).toContain('companies.csv');
    expect(rows[0]).toContain('Компании');
    expect(rows[0]).toContain('5');
    expect(rows[0]).toContain('все распознаны');

    // 2. Распознан, но часть колонок мимо — это предупреждение, а не отказ.
    expect(rows[1]).toContain('Контакты');
    expect(rows[1]).toContain('не распознаны: Лишняя');

    // 3. Не распознан, но ясно, на что похоже и чего не хватило.
    expect(rows[2]).toContain('Не распознан');
    expect(rows[2]).toContain('похоже на «Сделки», не хватает: Стадия сделки');

    // 4. Не распознан и кандидата нет.
    expect(rows[3]).toContain('Не распознан');
    expect(rows[3]).toContain('шапка не похожа ни на одну выгрузку Битрикс24');

    // Итог: сохранились только файлы с ключом.
    expect(ui.statusText()).toContain('Сохранено файлов: 2 из 4.');
    expect(ui.statusText()).toContain('форма «Новый пакет» появится на этой вкладке');
    expect(ui.alertText()).toBe('');
  });

  it('после успеха выбор файлов сброшен — повтор не грузит те же файлы заново', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, files: FOUR_FILES }));
    const ui = renderForm();

    submitWithFiles(ui);
    await waitFor(() => expect(ui.table()).not.toBeNull());
    // Иначе второе нажатие отправило бы тот же набор и наплодило ключей в S3.
    expect(ui.input().value).toBe('');
  });

  it('ни одного сохранённого файла — итог объясняет, что делать', async () => {
    const rejected = FOUR_FILES.map((f) => ({ ...f, key: null }));
    fetchMock.mockResolvedValue(okJson({ ok: true, files: rejected }));
    const ui = renderForm();

    submitWithFiles(ui);

    await waitFor(() => expect(ui.table()).not.toBeNull());
    expect(ui.rows()).toHaveLength(4);
    expect(ui.status()?.textContent).toBe(
      'Ни один файл не сохранён: поправьте шапки и загрузите снова.'
    );
  });

  it('успех без поля files: таблицы нет вовсе, итог — «ни один файл не сохранён»', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    const ui = renderForm();

    submitWithFiles(ui);

    // Пустая таблица с одной шапкой хуже её отсутствия: показываем только итог.
    await waitFor(() => expect(ui.statusText()).not.toBe(''));
    expect(ui.table()).toBeNull();
    expect(ui.statusText()).toBe('Ни один файл не сохранён: поправьте шапки и загрузите снова.');
  });
});

describe('BitrixUploadForm — ошибки', () => {
  it('413 too_large: русский текст с числом из общего лимита', async () => {
    fetchMock.mockResolvedValue(errJson(413, { error: 'too_large' }));
    const ui = renderForm();

    submitWithFiles(ui);

    await waitFor(() => expect(ui.alertText()).not.toBe(''));
    expect(ui.alertText()).toBe(
      `Файл больше ${IMPORT_MAX_FILE_MB} МБ — разбейте выгрузку по периодам.`
    );
    expect(ui.hidden(ui.alert())).toBe(false);
    expect(ui.table()).toBeNull();
  });

  it('404 без тела: подсказка про выключенный флаг bitrix_migration', async () => {
    fetchMock.mockResolvedValue(errNoBody(404));
    const ui = renderForm();

    submitWithFiles(ui);

    await waitFor(() => expect(ui.alertText()).not.toBe(''));
    expect(ui.alertText()).toBe(
      'Миграция из Битрикс24 выключена — включите флаг bitrix_migration в системных настройках.'
    );
  });

  it('no_files: просит выбрать хотя бы один файл', async () => {
    fetchMock.mockResolvedValue(errJson(400, { error: 'no_files' }));
    const ui = renderForm();

    submitWithFiles(ui);

    await waitFor(() => expect(ui.alertText()).not.toBe(''));
    expect(ui.alertText()).toBe('Выберите хотя бы один файл выгрузки.');
  });

  it('повторная отправка стирает прежнюю таблицу: после ошибки прошлого результата на экране нет', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true, files: FOUR_FILES }));
    const ui = renderForm();

    submitWithFiles(ui);
    await waitFor(() => expect(ui.table()).not.toBeNull());

    fetchMock.mockResolvedValueOnce(errJson(500, { error: 'storage' }));
    // Поле после успеха очищено — человек выбирает файлы заново, как в жизни.
    submitWithFiles(ui);

    await waitFor(() => expect(ui.alertText()).not.toBe(''));
    expect(ui.alertText()).toBe('Хранилище файлов недоступно. Попробуйте ещё раз через минуту.');
    expect(ui.table()).toBeNull();
    expect(ui.statusText()).toBe('');
    expect(ui.text()).not.toContain('deals.csv');
  });
});
