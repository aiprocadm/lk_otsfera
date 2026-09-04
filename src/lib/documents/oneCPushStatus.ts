import type { OneCPushStatus } from '@prisma/client';

/**
 * Этап 8 (`У-169`): состояние выгрузки документа в 1С — одним объектом.
 *
 * Подписи нужны трём экранам сразу: карточке (блок «Выгрузка в 1С»), бейджу
 * в списке и фильтру над списком. Один словарь — одно название на всех
 * кабинетах (правило зеркала §15 CLAUDE.md); разбросанные по компонентам
 * строки разъезжаются первым же PR.
 *
 * `skipped` никем не ставится (статус зарезервирован), `exported_file` —
 * документ уехал файлом через ручную выгрузку (`У-171`).
 */
export const ONE_C_PUSH_STATUS_LABEL: Record<OneCPushStatus, string> = {
  none: 'Не выгружался',
  pending: 'В очереди',
  pushed: 'Выгружен',
  failed: 'Ошибка выгрузки',
  skipped: 'Пропущен',
  exported_file: 'Выгружен файлом',
};

/** Порядок — для `<select>` фильтра: сначала то, что требует внимания. */
export const ONE_C_PUSH_STATUS_ORDER: readonly OneCPushStatus[] = [
  'failed',
  'none',
  'pending',
  'pushed',
  'exported_file',
  'skipped',
];

/**
 * Значение из адресной строки (`?oneCPushStatus=failed`) → статус или
 * `undefined`. Чужое слово в адресе — не ошибка, а «без фильтра».
 */
export function parseOneCPushStatus(value: string | undefined): OneCPushStatus | undefined {
  if (!value) return undefined;
  return Object.hasOwn(ONE_C_PUSH_STATUS_LABEL, value) ? (value as OneCPushStatus) : undefined;
}
