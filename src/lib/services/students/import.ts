import type ExcelJS from 'exceljs';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';
import { cellToString } from '@/lib/services/import/parse-workbook';
import { recordAudit } from '@/lib/auth/audit';
import { studentOrgAccess } from './access';
import { normalizeSnils } from './duplicates';

/**
 * Импорт сотрудников списком (`У-27`, `У-28`, этап 5 PR-2).
 *
 * Два шага, как у импорта 1С: **предпросмотр ничего не пишет**, запись
 * происходит только по подтверждению и одной транзакцией — файл не может
 * примениться наполовину.
 *
 * Обязательна только ФИО (`У-27`): в охране труда почты у рабочих часто нет,
 * а СНИЛС приносят позже.
 */
export const STUDENT_IMPORT_COLUMNS = {
  name: 'ФИО',
  position: 'Должность',
  snils: 'СНИЛС',
  birthDate: 'Дата рождения',
  email: 'Email',
  phone: 'Телефон',
} as const;

export type StudentImportRow = {
  /** Номер строки в файле — чтобы ошибка указывала на конкретную строку. */
  line: number;
  name: string;
  position: string | null;
  snils: string | null;
  birthDate: Date | null;
  email: string | null;
  phone: string | null;
};

export type StudentImportPreview = {
  toCreate: StudentImportRow[];
  /** Совпал с существующим сотрудником — создавать не будем (`У-22`). */
  duplicates: Array<{ row: StudentImportRow; existingId: string; existingName: string }>;
  errors: string[];
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function cellToDate(value: ExcelJS.CellValue): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000);
  }
  const text = cellToString(value).trim();
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = ru ? `${ru[3]}-${ru[2]}-${ru[1]}` : text;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeHeader(text: string): string {
  return text.replace(/\*/g, '').trim().toLowerCase();
}

/** Разбор файла. Ошибки — построчные и по-русски (§3 CLAUDE.md). */
export async function parseStudentsWorkbook(
  buffer: Buffer | ArrayBuffer
): Promise<
  { ok: true; rows: StudentImportRow[]; errors: string[] } | { ok: false; errors: string[] }
> {
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadXlsxWorkbook(buffer);
  } catch {
    return {
      ok: false,
      errors: ['Не удалось прочитать файл — ожидается Excel (.xlsx). Скачайте шаблон.'],
    };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, errors: ['В файле нет ни одного листа. Скачайте шаблон.'] };

  const headerRow = ws.getRow(1);
  const index = new Map<string, number>();
  headerRow.eachCell((cell, col) => index.set(normalizeHeader(cellToString(cell.value)), col));

  const nameCol = index.get(normalizeHeader(STUDENT_IMPORT_COLUMNS.name));
  if (!nameCol) {
    return {
      ok: false,
      errors: ['В первой строке файла нет колонки «ФИО». Скачайте шаблон и заполните его.'],
    };
  }
  const col = (key: keyof typeof STUDENT_IMPORT_COLUMNS): number | undefined =>
    index.get(normalizeHeader(STUDENT_IMPORT_COLUMNS[key]));

  const rows: StudentImportRow[] = [];
  const errors: string[] = [];

  for (let line = 2; line <= ws.rowCount; line++) {
    const r = ws.getRow(line);
    const text = (key: keyof typeof STUDENT_IMPORT_COLUMNS): string => {
      const c = col(key);
      return c ? cellToString(r.getCell(c).value).trim() : '';
    };

    const name = text('name');
    const snils = text('snils');
    // Пустая строка в конце файла — не ошибка, просто хвост.
    if (!name && !snils && !text('email') && !text('phone')) continue;

    if (!name) {
      errors.push(`Строка ${line}: не указана ФИО — это единственное обязательное поле.`);
      continue;
    }
    if (snils && normalizeSnils(snils)?.length !== 11) {
      errors.push(`Строка ${line}: СНИЛС должен содержать 11 цифр.`);
      continue;
    }

    const birthCol = col('birthDate');
    rows.push({
      line,
      name,
      position: text('position') || null,
      snils: snils || null,
      birthDate: birthCol ? cellToDate(r.getCell(birthCol).value) : null,
      email: text('email') || null,
      phone: text('phone') || null,
    });
  }

  return { ok: true, rows, errors };
}

/**
 * Шаг 1 (`У-28`): считаем, что произойдёт. **Ничего не пишем.**
 */
export async function previewStudentImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string; teamMode: boolean; rows: StudentImportRow[] }
): Promise<{ ok: true; preview: StudentImportPreview } | { ok: false; error: 'forbidden' }> {
  const access = await studentOrgAccess(prisma, session, args.organizationId, args.teamMode);
  if (!access.canWrite) return { ok: false, error: 'forbidden' };

  const existing = await prisma.student.findMany({
    where: { organizationId: args.organizationId },
    select: { id: true, name: true, snils: true, birthDate: true, email: true },
  });

  const preview: StudentImportPreview = { toCreate: [], duplicates: [], errors: [] };
  const seen = [...existing];

  for (const row of args.rows) {
    const snils = normalizeSnils(row.snils);
    const match =
      (snils ? seen.find((s) => normalizeSnils(s.snils) === snils) : undefined) ??
      (row.birthDate
        ? seen.find(
            (s) =>
              s.name === row.name &&
              s.birthDate !== null &&
              s.birthDate.getTime() === row.birthDate!.getTime()
          )
        : undefined) ??
      (row.email ? seen.find((s) => s.name === row.name && s.email === row.email) : undefined);

    if (match) {
      preview.duplicates.push({ row, existingId: match.id, existingName: match.name });
      continue;
    }
    preview.toCreate.push(row);
    // Дубли внутри самого файла тоже ловим — иначе одна и та же строка дважды
    // создаст двух сотрудников.
    seen.push({
      id: `new-${row.line}`,
      name: row.name,
      snils: row.snils,
      birthDate: row.birthDate,
      email: row.email,
    });
  }

  return { ok: true, preview };
}

/**
 * Шаг 2 (`У-28`): пишем ровно то, что показал предпросмотр — одной транзакцией.
 */
export async function importStudents(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string; teamMode: boolean; rows: StudentImportRow[] }
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: 'forbidden' }> {
  const pre = await previewStudentImport(prisma, session, args);
  if (!pre.ok) return pre;

  const { toCreate, duplicates } = pre.preview;
  if (toCreate.length > 0) {
    await prisma.$transaction(
      toCreate.map((row) =>
        prisma.student.create({
          data: {
            organizationId: args.organizationId,
            name: row.name,
            position: row.position,
            snils: row.snils,
            birthDate: row.birthDate,
            email: row.email,
            phone: row.phone,
          },
        })
      )
    );
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'student_created',
    entity: 'organization',
    entityId: args.organizationId,
    // Список ПДн в аудит не кладём — только счётчики (§25.7).
    after: { importedStudents: toCreate.length, skippedDuplicates: duplicates.length },
  });

  return { ok: true, created: toCreate.length, skipped: duplicates.length };
}
