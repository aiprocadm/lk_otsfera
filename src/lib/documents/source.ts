import type { Prisma } from '@prisma/client';

/**
 * Откуда в системе взялся документ (`У-258`, этап 8).
 *
 * На едином экране «Документы» сотрудника лежит всё вперемешку: выпущенные в
 * кабинете счета, приехавшие из 1С акты, сканы от клиента, файлы из Битрикса.
 * Пока источник не виден, список читается как свалка, а вопрос «откуда этот
 * документ» решается открыванием карточки по одной.
 *
 * **Новой колонки в базе для этого не завели** (`Р-Э8-2`): все шесть источников
 * различаются полями, которые уже есть. Пакет требований предлагал
 * `Document.uploadedByRole` с бэкфиллом по журналу — сверка показала, что поле
 * было бы копией того, что и так известно, а копия однажды разойдётся с
 * оригиналом.
 *
 * **Оговорка записана честно:** роль загрузившего читается ТЕКУЩАЯ, а не на
 * момент загрузки. Внутри контура исполнителя это ничего не меняет — менеджер,
 * руководитель и администратор попадают в одно ведро «сотрудник», — а перехода
 * клиента в сотрудники продукт не предусматривает. Появится такой переход —
 * тогда и появится смысл хранить роль в момент загрузки.
 *
 * Порядок проверки важен и не переставляется: документ из Битрикса мог приехать
 * туда из 1С, а выпущенный в кабинете — быть выгружен в 1С и получить
 * `externalId`. Спрашиваем сначала «откуда приехал», потом «кем создан».
 */

export const DOCUMENT_SOURCES = [
  'generated',
  'one_c',
  'bitrix',
  'client',
  'partner',
  'staff',
  'unknown',
] as const;

export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

/**
 * Русские названия — один словарь на фильтр, колонку списка и подпись в
 * карточке (правило зеркала §0.2). Две копии разошлись бы словами, и один и
 * тот же документ назывался бы по-разному на соседних экранах.
 */
export const DOCUMENT_SOURCE_LABELS: Record<DocumentSource, string> = {
  generated: 'Выпущен в кабинете',
  one_c: 'Из 1С',
  bitrix: 'Из Битрикса',
  client: 'Загружен клиентом',
  partner: 'Загружен партнёром',
  staff: 'Загружен сотрудником',
  unknown: 'Источник не определён',
};

/** Роли контура исполнителя — одно ведро «сотрудник» (см. оговорку выше). */
const STAFF_ROLES = ['manager', 'leader', 'admin'] as const;

/** Все роли, для которых источник назван явно; остальное — «не определён». */
const KNOWN_UPLOADER_ROLES = ['organization', 'partner', ...STAFF_ROLES] as const;

/** Поля, которых достаточно, чтобы назвать источник. */
export type DocumentSourceFields = {
  bitrixId: string | null;
  externalId: string | null;
  generatedBy: string;
  uploadedBy: { role: string } | null;
};

export function documentSource(doc: DocumentSourceFields): DocumentSource {
  if (doc.bitrixId) return 'bitrix';
  if (doc.externalId) return 'one_c';
  if (doc.generatedBy !== 'user') return 'generated';

  const role = doc.uploadedBy?.role ?? null;
  if (role === 'organization') return 'client';
  if (role === 'partner') return 'partner';
  if (role !== null && (STAFF_ROLES as readonly string[]).includes(role)) return 'staff';

  // Загрузчик неизвестен: строка старше журнала загрузок или пользователь
  // удалён. Врать «загружен сотрудником» нельзя — человек примет догадку за
  // факт и будет искать виноватого не там.
  return 'unknown';
}

export function isDocumentSource(value: string): value is DocumentSource {
  return (DOCUMENT_SOURCES as readonly string[]).includes(value);
}

/**
 * Условие выборки под каждый источник — **рядом с самим определением**.
 *
 * Фильтр и признак обязаны жить в одном файле: разведи их по разным местам, и
 * однажды колонка покажет «Из 1С», а фильтр «Из 1С» эту строку не найдёт.
 * Условия зеркальны `documentSource` вплоть до порядка: у более позднего
 * источника исключаются признаки более раннего.
 */
export function documentSourceWhere(source: DocumentSource): Prisma.DocumentWhereInput {
  const notImported = { bitrixId: null, externalId: null };
  switch (source) {
    case 'bitrix':
      return { bitrixId: { not: null } };
    case 'one_c':
      return { bitrixId: null, externalId: { not: null } };
    case 'generated':
      return { ...notImported, generatedBy: { not: 'user' } };
    case 'client':
      return { ...notImported, generatedBy: 'user', uploadedBy: { role: 'organization' } };
    case 'partner':
      return { ...notImported, generatedBy: 'user', uploadedBy: { role: 'partner' } };
    case 'staff':
      return {
        ...notImported,
        generatedBy: 'user',
        uploadedBy: { role: { in: [...STAFF_ROLES] } },
      };
    default:
      // «Источник не определён» — это и отсутствие загрузчика, и роль, которой
      // нет в списке известных. Условие только по `uploadedById: null` вторую
      // половину таких строк не нашло бы, и они пропали бы из всех фильтров.
      return {
        ...notImported,
        generatedBy: 'user',
        OR: [
          { uploadedById: null },
          { uploadedBy: { role: { notIn: [...KNOWN_UPLOADER_ROLES] } } },
        ],
      };
  }
}
