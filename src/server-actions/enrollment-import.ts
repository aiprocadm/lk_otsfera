'use server';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import { prisma } from '@/lib/db/prisma';
import {
  parseEnrollmentImportWorkbook,
  type EnrollmentImportResult,
} from '@/lib/services/enrollments/importRows';
import { resolveDirectionNames } from '@/lib/services/enrollments/resolveDirections';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Разбор Excel-файла со слушателями для мастера заявки (этап 2 PR-2).
 * Тонкий адаптер (§3): гейты сессии/флага/файла, парсинг — в сервисе.
 * Возвращает построчный результат: валидные позиции + русские ошибки строк.
 */
export async function parseEnrollmentImportAction(form: FormData): Promise<EnrollmentImportResult> {
  const session = await requireSession();
  if (!isFeatureEnabled('enrollment_requests') || !canSubmitEnrollments(session)) {
    return { ok: false, errors: ['Недостаточно прав для импорта слушателей'] };
  }
  const file = form.get('file');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_BYTES ||
    !file.name.toLowerCase().endsWith('.xlsx')
  ) {
    return {
      ok: false,
      errors: ['Выберите файл Excel (.xlsx) размером до 10 МБ — скачайте шаблон и заполните его.'],
    };
  }
  const parsed = await parseEnrollmentImportWorkbook(Buffer.from(await file.arrayBuffer()));
  if (!parsed.ok) return parsed;

  // `У-41`: парсер отдаёт НАЗВАНИЯ направлений, справочник есть только здесь.
  // Строка с непонятным названием отсеивается с ошибкой — как любая другая
  // невалидная строка построчного импорта; молча импортировать её без
  // направления нельзя, иначе человек не заметит потерю.
  const resolved = await resolveDirectionNames(
    prisma,
    parsed.itemDirections.map((d) => d.name),
    (i) => `Строка ${parsed.itemDirections[i]!.row}`
  );
  const items = parsed.items
    .map((item, i) => ({ ...item, directionId: resolved.ids[i] ?? null }))
    .filter((_, i) => !(parsed.itemDirections[i]!.name && resolved.ids[i] === null));
  const itemDirections = parsed.itemDirections.filter(
    (d, i) => !(d.name && resolved.ids[i] === null)
  );

  return {
    ok: true,
    items,
    itemDirections,
    errors: [...parsed.errors, ...resolved.errors],
    warnings: parsed.warnings,
  };
}
