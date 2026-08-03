/**
 * Инвариант-тесты «дедупликация слушателя» — «исполняемое ТЗ» (фаза 6).
 *
 * РЕЗУЛЬТАТ РАЗВЕДКИ (важно): формулировка из аудита «дедуп по СНИЛС;
 * резервный ключ — ФИО + дата рождения» в системе НЕ реализована и в
 * действующем ТЗ v0.5 ОТСУТСТВУЕТ (grep «СНИЛС» по
 * docs/tz/2026-07-29-tz-lk-otsfera-v0.5.md — ноль вхождений; единственная
 * дедупликация в ТЗ — платежи по номеру документа 1С, §7). Фактическая
 * модель (решение заказчика 2026-07-23/24, docs/tz/STATUS.md + спека
 * docs/superpowers/specs/2026-07-23-stage2-enrollment-wizard-design.md):
 *
 *   1. СНИЛС — необязательное поле ПОЗИЦИИ заявки; проверяется только формат
 *      (11 цифр, без контрольной суммы); ключом дедупликации НЕ является
 *      (src/lib/services/enrollments/validate.ts, normalizeSnils + dedupeKey).
 *   2. Ключ дедупликации слушателя внутри заявки: studentId (существующий
 *      сотрудник) либо email (новый) — validate.ts; Excel-импорт — email
 *      (src/lib/services/enrollments/importRows.ts).
 *   3. Справочник сотрудников: БД-инвариант @@unique([organizationId, email])
 *      (prisma/schema.prisma, model Student) — «один email = один сотрудник»
 *      в границах организации.
 *   4. Student НАМЕРЕННО не хранит СНИЛС/дату рождения (комментарий над
 *      EnrollmentRequestItem в schema.prisma: «данные относятся к конкретному
 *      обучению») — дедуп по СНИЛС/ФИО+ДР невозможен по построению.
 *
 * Тесты пришпиливают фактическую модель, ВКЛЮЧАЯ её негативное пространство
 * (СНИЛС и ФИО+ДР — не ключи). Если кто-то начнёт склеивать по СНИЛС или
 * перестанет склеивать по email — тесты падают и требуют осознанного решения
 * заказчика. Это не алиасы services.enrollments.validate/importRows-тестов:
 * там проверяется позитивная семантика склейки, здесь — какой именно ключ
 * является (и какой НЕ является) идентичностью слушателя.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { validateEnrollmentItems } from '@/lib/services/enrollments/validate';
import { parseEnrollmentImportWorkbook } from '@/lib/services/enrollments/importRows';

const HEADERS = ['ФИО', 'Email', 'Должность', 'СНИЛС', 'Дата рождения', 'Дополнительно'];

async function buildXlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Слушатели');
  ws.addRow(HEADERS as never);
  for (const row of rows) ws.addRow(row as never);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('Дедупликация слушателя: фактический ключ — email (в границах заявки и организации); СНИЛС дедуп-ключом не является', () => {
  it('позиции с одинаковым email склеиваются в одного слушателя (первая побеждает), даже при РАЗНЫХ СНИЛС — ключ именно email', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Иванов Иван', email: 'dup@x.ru', snils: '111-222-333 44' },
      { fullName: 'Иванов И.', email: 'DUP@x.ru', snils: '555-666-777 88' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
    expect(r.items).toHaveLength(1);
    // Побеждает первая позиция целиком — включая её СНИЛС.
    expect(r.items[0].snils).toBe('11122233344');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('дубликат');
  });

  it('повторный выбор того же сотрудника организации (studentId) склеивается в одну позицию', () => {
    const r = validateEnrollmentItems([{ studentId: 'stu-1' }, { studentId: 'stu-1' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });

  it('одинаковый СНИЛС при разных email — ДВЕ позиции: СНИЛС не является ключом дедупликации', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Иванов Иван', email: 'a@x.ru', snils: '112-233-445 95' },
      { fullName: 'Иванов Иван', email: 'b@x.ru', snils: '112-233-445 95' },
    ]);
    if (!r.ok) throw new Error('expected ok');
    // Разворот (склейка по СНИЛС) — осознанное решение заказчика, не дрейф.
    expect(r.items).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });

  it('одинаковые ФИО и дата рождения при разных email — ДВЕ позиции: резервного ключа «ФИО + дата рождения» нет', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Петров Пётр', email: 'p1@x.ru', birthDate: '1990-01-01' },
      { fullName: 'Петров Пётр', email: 'p2@x.ru', birthDate: '1990-01-01' },
    ]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });

  it('Excel-импорт: строка с повторным email пропускается с предупреждением, даже если СНИЛС в ней другой', async () => {
    const buf = await buildXlsx([
      ['Иванов Иван', 'dup@x.ru', '', '112-233-445 95', '', ''],
      ['Иванов И. И.', 'DUP@X.RU', '', '999-888-777 66', '', ''],
      ['Сидоров Семён', 'other@x.ru', '', '', '', ''],
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items.map((i) => i.email)).toEqual(['dup@x.ru', 'other@x.ru']);
    expect(r.items[0].snils).toBe('11223344595');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('дубликат email');
  });
});

describe('Справочник сотрудников (Student): идентичность — email в границах организации, СНИЛС в карточке не хранится', () => {
  const student = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Student');
  const item = Prisma.dmmf.datamodel.models.find((m) => m.name === 'EnrollmentRequestItem');

  it('в организации не может быть двух сотрудников с одним email — @@unique([organizationId, email]) в схеме', () => {
    // БД-уровень того же инварианта «ключ = email». Разворот (снятие unique
    // или замена ключа) требует миграции и уронит этот тест при prisma:generate.
    expect(student?.uniqueFields).toContainEqual(['organizationId', 'email']);
  });

  it('Student намеренно не хранит СНИЛС и дату рождения — дедупликация по ним невозможна по построению; СНИЛС живёт в позиции заявки', () => {
    const studentFields = (student?.fields ?? []).map((f) => f.name);
    expect(studentFields).not.toContain('snils');
    expect(studentFields).not.toContain('birthDate');
    // …а у позиции заявки эти поля есть (данные конкретного обучения).
    const itemFields = (item?.fields ?? []).map((f) => f.name);
    expect(itemFields).toEqual(expect.arrayContaining(['snils', 'birthDate', 'fullName']));
  });
});
