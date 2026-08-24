import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Экшены справочника сотрудников (`У-24`…`У-28`, этап 5).
 *
 * Оба файла исполнялись только через `vi.mock` в тестах компонентов — то есть
 * их собственный код не проверял никто (долг гейта покрытия). Проверяем ровно
 * то, за что отвечает адаптер: разбор формы, **свежий** режим видимости команды
 * из базы (пропуск молча сузил бы выборку, C8), обновление всех экранов, где
 * сотрудник виден, и человеческие тексты отказов.
 */
const {
  requireSession,
  getCompanyTeamVisibility,
  createStudent,
  revalidatePath,
  parseStudentsWorkbook,
  previewStudentImport,
  importStudents,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  createStudent: vi.fn(),
  revalidatePath: vi.fn(),
  parseStudentsWorkbook: vi.fn(),
  previewStudentImport: vi.fn(),
  importStudents: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireSession }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
vi.mock('@/lib/services/students/crud', () => ({ createStudent }));
vi.mock('@/lib/services/students/import', () => ({
  parseStudentsWorkbook,
  previewStudentImport,
  importStudents,
}));

import { createStudentAction } from '@/server-actions/students';
import {
  previewStudentsAction,
  commitStudentsImportAction,
} from '@/server-actions/students-import';

const ORG = 'org-1';

function form(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const okSession = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  value: { sub: 'u1', role: 'admin', ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(okSession());
  createStudent.mockResolvedValue({ ok: true, id: 's-new' });
  getCompanyTeamVisibility.mockResolvedValue(true);
});

describe('createStudentAction (У-24…У-26)', () => {
  it('без сессии в сервис не заходит', async () => {
    requireSession.mockResolvedValue({ ok: false });
    await expect(createStudentAction(form({ name: 'Иванов' }))).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(createStudent).not.toHaveBeenCalled();
  });

  it('без организации не пишет — сотруднику некуда лечь', async () => {
    const res = await createStudentAction(form({ name: 'Иванов' }));
    expect(res).toEqual({ ok: false, error: 'validation', messages: ['Организация не задана'] });
    expect(createStudent).not.toHaveBeenCalled();
  });

  it('непонятная дата рождения объясняется по-русски и до записи', async () => {
    const res = await createStudentAction(
      form({ organizationId: ORG, name: 'Иванов', birthDate: 'вчера' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Дата рождения указана неверно'],
    });
    expect(createStudent).not.toHaveBeenCalled();
  });

  it('пустая дата — это «не указана», а не ошибка', async () => {
    await createStudentAction(form({ organizationId: ORG, name: 'Иванов', birthDate: '' }));
    expect(createStudent.mock.calls[0][2].birthDate).toBeNull();
  });

  it('поля формы доходят до сервиса как есть, включая «Всё равно добавить»', async () => {
    await createStudentAction(
      form({
        organizationId: ORG,
        name: 'Иванов Иван',
        position: 'Электромонтёр',
        snils: '112-233-445 95',
        birthDate: '1990-01-01',
        email: 'i@e.ru',
        phone: '+7 900',
        note: 'ночная смена',
        force: '1',
      })
    );
    const args = createStudent.mock.calls[0][2];
    expect(args).toMatchObject({
      organizationId: ORG,
      name: 'Иванов Иван',
      position: 'Электромонтёр',
      snils: '112-233-445 95',
      email: 'i@e.ru',
      phone: '+7 900',
      note: 'ночная смена',
      force: true,
    });
    expect(args.birthDate?.toISOString().slice(0, 10)).toBe('1990-01-01');
  });

  it('без флажка «Всё равно добавить» force не выставляется', async () => {
    await createStudentAction(form({ organizationId: ORG, name: 'Иванов' }));
    expect(createStudent.mock.calls[0][2].force).toBe(false);
  });

  it('режим видимости команды берётся свежим из базы', async () => {
    requireSession.mockResolvedValue(okSession({ role: 'manager', companyId: 'c1' }));
    await createStudentAction(form({ organizationId: ORG, name: 'Иванов' }));

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(createStudent.mock.calls[0][2].teamMode).toBe(true);
  });

  it('без компании в базу за режимом не ходим', async () => {
    await createStudentAction(form({ organizationId: ORG, name: 'Иванов' }));
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(createStudent.mock.calls[0][2].teamMode).toBe(false);
  });

  // `У-103`: экранов пять — вкладка «Сотрудники» появилась и у руководителя
  // (`У-101`). Пропуск пути = «добавил, а в соседнем кабинете не видно».
  it('после успеха обновляются все пять экранов, где сотрудник виден', async () => {
    await createStudentAction(form({ organizationId: ORG, name: 'Иванов' }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/organization/students',
      `/partner/portfolio/${ORG}`,
      `/manager/organizations/${ORG}`,
      `/leader/organizations/${ORG}`,
      `/admin/organizations/${ORG}`,
    ]);
  });

  it('после отказа сервиса экраны не трогаем и ответ отдаём как есть', async () => {
    createStudent.mockResolvedValue({
      ok: false,
      error: 'duplicate_found',
      match: 'snils',
      candidates: [],
    });
    const res = await createStudentAction(form({ organizationId: ORG, name: 'Иванов' }));

    expect(res).toMatchObject({ ok: false, error: 'duplicate_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('previewStudentsAction (У-27) — шаг «что произойдёт»', () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], 'list.xlsx');

  beforeEach(() => {
    parseStudentsWorkbook.mockResolvedValue({
      ok: true,
      rows: [{ name: 'Иванов Иван', line: 2 }],
      errors: [],
    });
    previewStudentImport.mockResolvedValue({
      ok: true,
      preview: { toCreate: [{ name: 'Иванов Иван', line: 2 }], duplicates: [] },
    });
  });

  it('без сессии файл даже не читается', async () => {
    requireSession.mockResolvedValue({ ok: false });
    await expect(
      previewStudentsAction(form({ organizationId: ORG, file: file() }))
    ).resolves.toEqual({ ok: false, errors: ['Нет доступа.'] });
    expect(parseStudentsWorkbook).not.toHaveBeenCalled();
  });

  it('без файла или без организации просит их выбрать', async () => {
    await expect(previewStudentsAction(form({ organizationId: ORG }))).resolves.toEqual({
      ok: false,
      errors: ['Выберите файл и организацию.'],
    });
    await expect(previewStudentsAction(form({ file: file() }))).resolves.toEqual({
      ok: false,
      errors: ['Выберите файл и организацию.'],
    });
  });

  it('ошибки разбора файла возвращаются человеку как есть', async () => {
    parseStudentsWorkbook.mockResolvedValue({ ok: false, errors: ['Не найдена колонка «ФИО»'] });
    await expect(
      previewStudentsAction(form({ organizationId: ORG, file: file() }))
    ).resolves.toEqual({ ok: false, errors: ['Не найдена колонка «ФИО»'] });
    expect(previewStudentImport).not.toHaveBeenCalled();
  });

  it('отказ прав объясняется словами, а не кодом', async () => {
    previewStudentImport.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(
      previewStudentsAction(form({ organizationId: ORG, file: file() }))
    ).resolves.toEqual({
      ok: false,
      errors: ['Нет прав добавлять сотрудников в эту организацию.'],
    });
  });

  it('предпросмотр ничего не пишет и возвращает разобранные строки для шага 2', async () => {
    const res = await previewStudentsAction(form({ organizationId: ORG, file: file() }));

    expect(importStudents).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, willCreate: 1, duplicates: [] });
    expect(res.ok && res.rows).toEqual([{ name: 'Иванов Иван', line: 2 }]);
  });

  it('дубли пересказаны понятно: строка, кто и на кого похож', async () => {
    previewStudentImport.mockResolvedValue({
      ok: true,
      preview: {
        toCreate: [],
        duplicates: [{ row: { line: 3, name: 'Петров Пётр' }, existingName: 'Петров П. П.' }],
      },
    });
    const res = await previewStudentsAction(form({ organizationId: ORG, file: file() }));
    expect(res).toMatchObject({
      ok: true,
      willCreate: 0,
      duplicates: [{ line: 3, name: 'Петров Пётр', existingName: 'Петров П. П.' }],
    });
  });

  it('ошибки отдельных строк не отменяют предпросмотр — остальное всё равно можно добавить', async () => {
    parseStudentsWorkbook.mockResolvedValue({
      ok: true,
      rows: [{ name: 'Иванов Иван', line: 2 }],
      errors: ['Строка 5: неверная дата'],
    });
    const res = await previewStudentsAction(form({ organizationId: ORG, file: file() }));
    expect(res).toMatchObject({ ok: true, willCreate: 1, errors: ['Строка 5: неверная дата'] });
  });

  it('менеджеру режим видимости команды берётся свежим', async () => {
    requireSession.mockResolvedValue(okSession({ role: 'manager', companyId: 'c1' }));
    await previewStudentsAction(form({ organizationId: ORG, file: file() }));
    expect(previewStudentImport.mock.calls[0][2].teamMode).toBe(true);
  });
});

describe('commitStudentsImportAction (У-28) — шаг записи', () => {
  beforeEach(() => {
    importStudents.mockResolvedValue({ ok: true, created: 2, skipped: 1 });
  });

  it('без сессии не пишет', async () => {
    requireSession.mockResolvedValue({ ok: false });
    await expect(commitStudentsImportAction(ORG, [])).resolves.toEqual({
      ok: false,
      error: 'Нет доступа.',
    });
    expect(importStudents).not.toHaveBeenCalled();
  });

  it('даты, пришедшие с клиента строками, возвращаются в настоящие даты', async () => {
    // После сериализации Date превращается в строку; без обратного разбора
    // сотрудник записался бы без даты рождения.
    await commitStudentsImportAction(ORG, [
      { name: 'Иванов', line: 2, birthDate: '1990-01-01T00:00:00.000Z' },
      { name: 'Петров', line: 3, birthDate: null },
    ] as never);

    const rows = importStudents.mock.calls[0][2].rows;
    expect(rows[0].birthDate).toBeInstanceOf(Date);
    expect(rows[0].birthDate.toISOString().slice(0, 10)).toBe('1990-01-01');
    expect(rows[1].birthDate).toBeNull();
  });

  it('после записи обновляет оба экрана, где список сотрудников виден', async () => {
    const res = await commitStudentsImportAction(ORG, []);
    expect(res).toEqual({ ok: true, created: 2, skipped: 1 });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/organization/students',
      `/partner/portfolio/${ORG}`,
    ]);
  });

  it('отказ прав объясняется словами, экраны не трогаются', async () => {
    importStudents.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(commitStudentsImportAction(ORG, [])).resolves.toEqual({
      ok: false,
      error: 'Нет прав добавлять сотрудников в эту организацию.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('менеджеру режим видимости команды берётся свежим', async () => {
    requireSession.mockResolvedValue(okSession({ role: 'manager', companyId: 'c1' }));
    await commitStudentsImportAction(ORG, []);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(importStudents.mock.calls[0][2].teamMode).toBe(true);
  });
});
