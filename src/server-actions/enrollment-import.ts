'use server';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import { parseEnrollmentImportWorkbook, type EnrollmentImportResult } from '@/lib/services/enrollments/importRows';

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
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !file.name.toLowerCase().endsWith('.xlsx')) {
    return { ok: false, errors: ['Выберите файл Excel (.xlsx) размером до 10 МБ — скачайте шаблон и заполните его.'] };
  }
  return parseEnrollmentImportWorkbook(Buffer.from(await file.arrayBuffer()));
}
