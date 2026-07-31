import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseEnrollmentImportWorkbook,
  ENROLLMENT_IMPORT_COLUMNS,
} from '@/lib/services/enrollments/importRows';

const HEADERS = ['ФИО', 'Email', 'Должность', 'СНИЛС', 'Дата рождения', 'Дополнительно'];

async function buildXlsx(rows: unknown[][], headers: unknown[] = HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Слушатели');
  ws.addRow(headers as never);
  for (const row of rows) ws.addRow(row as never);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const D1990 = new Date('1990-01-01T00:00:00.000Z');

describe('parseEnrollmentImportWorkbook (Excel-импорт слушателей, ФТ-2.1)', () => {
  it('шаблонные подписи колонок — контракт для генератора шаблона', () => {
    expect(ENROLLMENT_IMPORT_COLUMNS).toEqual({
      fullName: 'ФИО',
      email: 'Email',
      position: 'Должность',
      snils: 'СНИЛС',
      birthDate: 'Дата рождения',
      extra: 'Дополнительно',
    });
  });

  it('валидная строка: trim, email в нижний регистр, СНИЛС без маски, дата из «ДД.ММ.ГГГГ»', async () => {
    const buf = await buildXlsx([
      ['  Иван Иванов ', ' I@X.RU ', ' инженер ', '112-233-445 95', '01.01.1990', ' прим '],
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.items).toEqual([
      {
        studentId: null,
        fullName: 'Иван Иванов',
        email: 'i@x.ru',
        position: 'инженер',
        snils: '11223344595',
        birthDate: D1990,
        extra: 'прим',
      },
    ]);
  });

  it('файл только с обязательными колонками: необязательные поля берутся как пустые', async () => {
    // Заказчик может прислать свой файл, где есть только ФИО и Email. Импорт
    // обязан пройти: недостающие колонки — это не ошибка, а отсутствие данных.
    const buf = await buildXlsx([['Иван Иванов', 'i@x.ru']], ['ФИО', 'Email']);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([
      {
        studentId: null,
        fullName: 'Иван Иванов',
        email: 'i@x.ru',
        position: null,
        snils: null,
        birthDate: null,
        extra: null,
      },
    ]);
  });

  it('ошибки «Строка N: …» адресные; валидные строки того же файла возвращаются', async () => {
    const buf = await buildXlsx([
      ['', 'a@b.ru'], // строка 2: нет ФИО
      ['Пётр Петров', ''], // строка 3: нет email
      ['Сидор Сидоров', 'плохо'], // строка 4: кривой email
      ['Анна Каренина', 'anna@x.ru', '', '123'], // строка 5: СНИЛС не 11 цифр
      ['Борис Годунов', 'b@x.ru', '', '', 'зимой'], // строка 6: кривая дата
      ['Валид Валидов', 'ok@x.ru'], // строка 7: валидная
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ fullName: 'Валид Валидов', email: 'ok@x.ru' });
    expect(r.errors).toContain('Строка 2: не указано ФИО');
    expect(r.errors).toContain('Строка 3: не указан email');
    expect(r.errors).toContain('Строка 4: некорректный email «плохо»');
    expect(r.errors).toContain('Строка 5: СНИЛС должен содержать 11 цифр');
    expect(r.errors).toContain('Строка 6: некорректная дата рождения');
  });

  it('дата: Date-ячейка, serial-число, «ДД.ММ.ГГГГ» и ISO дают одинаковый результат', async () => {
    const buf = await buildXlsx([
      ['Один Первый', 'a1@x.ru', '', '', new Date(Date.UTC(1990, 0, 1))],
      ['Два Второй', 'a2@x.ru', '', '', 32874],
      ['Три Третий', 'a3@x.ru', '', '', '01.01.1990'],
      ['Четыре Четвёртый', 'a4@x.ru', '', '', '1990-01-01'],
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(4);
    for (const item of r.items) expect(item.birthDate).toEqual(D1990);
  });

  it('дубликат email внутри файла (регистронезависимо) → warning, строка пропущена', async () => {
    const buf = await buildXlsx([
      ['Иван Иванов', 'i@x.ru'],
      ['Иван Дубль', 'I@X.RU'],
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(1);
    expect(r.warnings).toEqual(['Строка 3: дубликат email «i@x.ru» — строка пропущена']);
  });

  it('заголовки регистронезависимы и со звёздочками («ФИО*», «EMAIL»)', async () => {
    const buf = await buildXlsx(
      [['Иван Иванов', 'i@x.ru', 'инженер']],
      ['фио*', ' EMAIL ', 'должность*', 'снилс', 'ДАТА РОЖДЕНИЯ', 'дополнительно']
    );
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items[0]).toMatchObject({
      fullName: 'Иван Иванов',
      email: 'i@x.ru',
      position: 'инженер',
    });
  });

  it('нет колонок «ФИО»/«Email» → ok:false с отсылкой к шаблону', async () => {
    const noneAtAll = await parseEnrollmentImportWorkbook(
      await buildXlsx([['x', '123']], ['Должность', 'СНИЛС'])
    );
    expect(noneAtAll).toEqual({
      ok: false,
      errors: ['В первой строке файла не найдены колонки «ФИО» и «Email». Скачайте шаблон.'],
    });
    const onlyFullName = await parseEnrollmentImportWorkbook(await buildXlsx([['Иван']], ['ФИО']));
    expect(onlyFullName).toMatchObject({ ok: false });
    expect((onlyFullName as { errors: string[] }).errors[0]).toContain('Скачайте шаблон');
  });

  it('полностью пустые строки листа пропускаются без ошибок', async () => {
    const buf = await buildXlsx([
      ['Иван Иванов', 'i@x.ru'],
      [],
      ['', '', '', '', '', ''],
      ['Пётр Петров', 'p@x.ru'],
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.email)).toEqual(['i@x.ru', 'p@x.ru']);
  });

  it('битый буфер → ok:false «Не удалось прочитать файл…»', async () => {
    const r = await parseEnrollmentImportWorkbook(Buffer.from('junk'));
    expect(r).toEqual({
      ok: false,
      errors: ['Не удалось прочитать файл — ожидается файл Excel (.xlsx). Скачайте шаблон.'],
    });
  });

  it('книга без единого листа → ok:false «нет ни одного листа»', async () => {
    const wb = new ExcelJS.Workbook(); // ни одного addWorksheet
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(await parseEnrollmentImportWorkbook(buf)).toEqual({
      ok: false,
      errors: ['В файле нет ни одного листа. Скачайте шаблон.'],
    });
  });

  it('файл только с заголовком → ok:false «нет ни одной строки»', async () => {
    const r = await parseEnrollmentImportWorkbook(await buildXlsx([]));
    expect(r).toEqual({
      ok: false,
      errors: ['В файле нет ни одной строки со слушателями (заполняются строки со 2-й).'],
    });
  });
});
