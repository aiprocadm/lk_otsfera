import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PR-2 (ФТ-2.1): server action parseEnrollmentImportAction — тонкий адаптер
 * (§3): гейты сессии/флага/файла на границе, парсинг — в сервисе
 * parseEnrollmentImportWorkbook (мокается).
 */

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { canSubmitEnrollments } = vi.hoisted(() => ({ canSubmitEnrollments: vi.fn() }));
vi.mock('@/lib/services/enrollments/policy', () => ({ canSubmitEnrollments }));

const { parseEnrollmentImportWorkbook } = vi.hoisted(() => ({
  parseEnrollmentImportWorkbook: vi.fn(),
}));
vi.mock('@/lib/services/enrollments/importRows', () => ({ parseEnrollmentImportWorkbook }));

const { resolveDirectionNames } = vi.hoisted(() => ({ resolveDirectionNames: vi.fn() }));
vi.mock('@/lib/services/enrollments/resolveDirections', () => ({ resolveDirectionNames }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { parseEnrollmentImportAction } from '@/server-actions/enrollment-import';

const SESSION = { sub: 'u1', role: 'organization' } as never;
const FILE_ERROR =
  'Выберите файл Excel (.xlsx) размером до 10 МБ — скачайте шаблон и заполните его.';
const RIGHTS_ERROR = 'Недостаточно прав для импорта слушателей';

const formWith = (file: FormDataEntryValue | null): FormData => {
  const form = new FormData();
  if (file !== null) form.set('file', file);
  return form;
};

beforeEach(() => {
  vi.resetAllMocks();
  requireSession.mockResolvedValue(SESSION);
  isFeatureEnabled.mockReturnValue(true);
  canSubmitEnrollments.mockReturnValue(true);
});

describe('parseEnrollmentImportAction', () => {
  it('флаг enrollment_requests выключен → «Недостаточно прав…», файл не разбирается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const res = await parseEnrollmentImportAction(formWith(new File(['x'], 'ok.xlsx')));
    expect(res).toEqual({ ok: false, errors: [RIGHTS_ERROR] });
    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('canSubmitEnrollments=false → та же ошибка прав', async () => {
    canSubmitEnrollments.mockReturnValue(false);
    const res = await parseEnrollmentImportAction(formWith(new File(['x'], 'ok.xlsx')));
    expect(res).toEqual({ ok: false, errors: [RIGHTS_ERROR] });
    expect(canSubmitEnrollments).toHaveBeenCalledWith(SESSION);
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('в форме не файл (строка) → ok:false про файл', async () => {
    const res = await parseEnrollmentImportAction(formWith('не-файл'));
    expect(res).toEqual({ ok: false, errors: [FILE_ERROR] });
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('пустой файл (size 0) → ok:false про файл', async () => {
    const res = await parseEnrollmentImportAction(formWith(new File([], 'empty.xlsx')));
    expect(res).toEqual({ ok: false, errors: [FILE_ERROR] });
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('файл больше 10 МБ → ok:false про файл', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.xlsx');
    const res = await parseEnrollmentImportAction(formWith(big));
    expect(res).toEqual({ ok: false, errors: [FILE_ERROR] });
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('расширение .xls (не .xlsx) → ok:false про файл', async () => {
    const res = await parseEnrollmentImportAction(formWith(new File(['x'], 'legacy.xls')));
    expect(res).toEqual({ ok: false, errors: [FILE_ERROR] });
    expect(parseEnrollmentImportWorkbook).not.toHaveBeenCalled();
  });

  it('успех → в сервис ушёл Buffer с содержимым файла, направления превращены в id (У-41)', async () => {
    parseEnrollmentImportWorkbook.mockResolvedValue({
      ok: true,
      items: [{ fullName: 'И', email: 'i@x.ru' }],
      itemDirections: [{ name: 'Работы на высоте', row: 2 }],
      errors: [],
      warnings: ['w'],
    });
    resolveDirectionNames.mockResolvedValue({ ids: ['d2'], errors: [] });

    const res = await parseEnrollmentImportAction(formWith(new File(['abc'], 'Слушатели.XLSX')));

    expect(res).toEqual({
      ok: true,
      items: [{ fullName: 'И', email: 'i@x.ru', directionId: 'd2' }],
      itemDirections: [{ name: 'Работы на высоте', row: 2 }],
      errors: [],
      warnings: ['w'],
    });
    expect(parseEnrollmentImportWorkbook).toHaveBeenCalledTimes(1);
    const arg = parseEnrollmentImportWorkbook.mock.calls[0][0];
    expect(Buffer.isBuffer(arg)).toBe(true);
    expect((arg as Buffer).toString('utf8')).toBe('abc');
    // Ошибка нумеруется по строке ФАЙЛА, а не по номеру позиции.
    expect(resolveDirectionNames.mock.calls[0][1]).toEqual(['Работы на высоте']);
    expect(resolveDirectionNames.mock.calls[0][2](0)).toBe('Строка 2');
  });

  it('ok:false из парсера отдаётся как есть — справочник не трогаем', async () => {
    const fail = { ok: false, errors: ['не тот файл'] };
    parseEnrollmentImportWorkbook.mockResolvedValue(fail);

    const res = await parseEnrollmentImportAction(formWith(new File(['abc'], 'f.xlsx')));

    expect(res).toBe(fail);
    expect(resolveDirectionNames).not.toHaveBeenCalled();
  });

  it('У-41: строка с непонятным направлением отсеивается и даёт ошибку, остальные проходят', async () => {
    parseEnrollmentImportWorkbook.mockResolvedValue({
      ok: true,
      items: [{ email: 'a@x.ru' }, { email: 'b@x.ru' }, { email: 'c@x.ru' }],
      itemDirections: [
        { name: 'Работы на высоте', row: 2 },
        { name: 'Полёты на Марс', row: 3 },
        { name: null, row: 4 },
      ],
      errors: ['Строка 9: без email'],
      warnings: [],
    });
    resolveDirectionNames.mockResolvedValue({
      ids: ['d2', null, null],
      errors: ['Строка 3: направление «Полёты на Марс» не найдено в справочнике.'],
    });

    const res = await parseEnrollmentImportAction(formWith(new File(['abc'], 'f.xlsx')));

    expect(res).toEqual({
      ok: true,
      // Строка 3 выброшена: молча импортировать её без направления нельзя.
      items: [
        { email: 'a@x.ru', directionId: 'd2' },
        { email: 'c@x.ru', directionId: null },
      ],
      itemDirections: [
        { name: 'Работы на высоте', row: 2 },
        { name: null, row: 4 },
      ],
      errors: [
        'Строка 9: без email',
        'Строка 3: направление «Полёты на Марс» не найдено в справочнике.',
      ],
      warnings: [],
    });
  });
});
