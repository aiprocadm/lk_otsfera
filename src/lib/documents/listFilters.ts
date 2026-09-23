import { moscowCalendarDay } from '@/lib/dates/calendar';
import { isDocumentSource, type DocumentSource } from './source';

/**
 * Разбор фильтров экрана «Документы» из адресной строки (`У-253`, этап 8).
 *
 * Чистая функция и один источник разбора на оба кабинета сотрудников: страница
 * менеджера и страница руководителя рисуют один и тот же экран, и два разных
 * разбора однажды разошлись бы — например, год у одного стал бы строкой, а у
 * другого числом.
 *
 * Правило общее с остальными фильтрами проекта: **чужое слово в адресе — это
 * «без фильтра», а не ошибка**. Человек, поправивший адрес руками, должен
 * увидеть список, а не страницу отказа.
 */

export type StaffDocumentFilters = {
  year?: number | undefined;
  direction?: 'incoming' | 'outgoing' | undefined;
  status?: string | undefined;
  source?: DocumentSource | undefined;
};

/** Состояния документа, по которым фильтруют (литералы `enum DocumentStatus`). */
export const DOCUMENT_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'draft', label: 'Черновик' },
  { value: 'issued', label: 'Выставлен' },
  { value: 'sent', label: 'Отправлен' },
  { value: 'accepted', label: 'Принят' },
  { value: 'rejected', label: 'Отклонён' },
  { value: 'cancelled', label: 'Аннулирован' },
];

export const DOCUMENT_DIRECTION_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'incoming', label: 'Входящие' },
  { value: 'outgoing', label: 'Исходящие' },
];

/**
 * Годы для выпадающего списка: текущий и пять предыдущих.
 *
 * Список считается от «сейчас», а не жёстко прописан: захардкоженный набор
 * молча устареет ровно 1 января, и человек не сможет отобрать документы за
 * новый год.
 */
export function documentYearOptions(now: Date = new Date()): number[] {
  // Прогон сопровождения №36: текущий год — московский, как и граница года в
  // выборке (`moscowYearRange`). `getFullYear()` по часам процесса (UTC)
  // 1 января с 00:00 до 03:00 по Москве не давал выбрать наступивший год.
  const current = Number(moscowCalendarDay(now).slice(0, 4));
  return [0, 1, 2, 3, 4, 5].map((back) => current - back);
}

export function parseStaffDocumentFilters(sp: {
  year?: string | undefined;
  direction?: string | undefined;
  status?: string | undefined;
  source?: string | undefined;
}): StaffDocumentFilters {
  const year = Number(sp.year);
  return {
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined,
    direction:
      sp.direction === 'incoming' || sp.direction === 'outgoing' ? sp.direction : undefined,
    status: DOCUMENT_STATUS_FILTER_OPTIONS.some((o) => o.value === sp.status)
      ? sp.status
      : undefined,
    source: sp.source && isDocumentSource(sp.source) ? sp.source : undefined,
  };
}
