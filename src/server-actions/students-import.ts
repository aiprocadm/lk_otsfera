'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import {
  parseStudentsWorkbook,
  previewStudentImport,
  importStudents,
  type StudentImportRow,
} from '@/lib/services/students/import';

/**
 * Импорт сотрудников списком (`У-27`, `У-28`, этап 5 PR-2).
 *
 * Два шага, как у импорта 1С: `previewStudentsAction` **ничего не пишет** и
 * возвращает разобранные строки, `commitStudentsImportAction` записывает ровно
 * их. Разобранные строки возвращаются клиенту и приходят обратно на шаге 2 —
 * файл не перечитывается, поэтому подтверждение применяет именно то, что
 * человек видел на экране.
 */
export type PreviewResult =
  | {
      ok: true;
      rows: StudentImportRow[];
      willCreate: number;
      duplicates: Array<{ line: number; name: string; existingName: string }>;
      errors: string[];
    }
  | { ok: false; errors: string[] };

async function teamModeFor(companyId: string | null | undefined): Promise<boolean> {
  return companyId ? getCompanyTeamVisibility(prisma, companyId) : false;
}

export async function previewStudentsAction(fd: FormData): Promise<PreviewResult> {
  const guard = await requireSession();
  if (!guard.ok) return { ok: false, errors: ['Нет доступа.'] };

  const organizationId = String(fd.get('organizationId') ?? '');
  const file = fd.get('file');
  if (!organizationId || !(file instanceof File)) {
    return { ok: false, errors: ['Выберите файл и организацию.'] };
  }

  const parsed = await parseStudentsWorkbook(await file.arrayBuffer());
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const res = await previewStudentImport(prisma, guard.value, {
    organizationId,
    teamMode: await teamModeFor(guard.value.companyId),
    rows: parsed.rows,
  });
  if (!res.ok) return { ok: false, errors: ['Нет прав добавлять сотрудников в эту организацию.'] };

  return {
    ok: true,
    rows: parsed.rows,
    willCreate: res.preview.toCreate.length,
    duplicates: res.preview.duplicates.map((d) => ({
      line: d.row.line,
      name: d.row.name,
      existingName: d.existingName,
    })),
    errors: parsed.errors,
  };
}

export async function commitStudentsImportAction(
  organizationId: string,
  rows: StudentImportRow[]
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  const guard = await requireSession();
  if (!guard.ok) return { ok: false, error: 'Нет доступа.' };

  const res = await importStudents(prisma, guard.value, {
    organizationId,
    teamMode: await teamModeFor(guard.value.companyId),
    // Даты после сериализации приходят строками — возвращаем их в Date.
    rows: rows.map((r) => ({ ...r, birthDate: r.birthDate ? new Date(r.birthDate) : null })),
  });
  if (!res.ok) return { ok: false, error: 'Нет прав добавлять сотрудников в эту организацию.' };

  revalidatePath('/organization/students');
  revalidatePath(`/partner/portfolio/${organizationId}`);
  return res;
}
