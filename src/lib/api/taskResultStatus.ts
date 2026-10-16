import type { TaskResultError } from '@/lib/services/tasks/result';

/**
 * Код сервиса результата задачи → HTTP-статус (этап 5 ТЗ 13.10.2026, `У-299`).
 * Отдельным модулем: из файла роута Next.js разрешает экспортировать только
 * обработчики, а таблица нужна двум роутам.
 */
const STATUS_BY_ERROR: Record<TaskResultError, number> = {
  forbidden: 403,
  not_found: 404,
  validation: 400,
  too_large: 413,
  invalid_mime: 415,
  storage: 500,
  // §10: заражённый файл — 410 Gone, а не 404.
  infected: 410,
};

export function taskResultStatus(error: TaskResultError): number {
  return STATUS_BY_ERROR[error];
}
