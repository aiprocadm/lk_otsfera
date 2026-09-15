/**
 * Семь мест, откуда заводится задача (`У-220`, этап 4 PR-2).
 *
 * Единый источник намеренно: до этого «откуда задача» жило в трёх местах —
 * сервис, server-action и панель на карточке, — и каждое знало ровно про два
 * вида связи. Добавить восьмой вид, поправив два места из трёх, было делом
 * одной невнимательности, и разъезд не поймал бы ни один тест.
 *
 * Файл ЧИСТЫЙ (никаких обращений к базе): его импортирует и сервис, и
 * `'use client'`-панель. Типы, нужные обеим сторонам, живут в `lib` (§2).
 */

/** Ссылка на объект, из карточки которого заводится задача. */
export type TaskLinkRef =
  | { orderId: string }
  | { organizationId: string }
  | { leadId: string }
  | { dealId: string }
  | { contactId: string }
  | { dialogId: string }
  | { documentId: string };

/**
 * Имя поля `Task`, в которое ложится эта связь. Оно же — имя поля формы:
 * `createTaskAction` читает из `FormData` ровно эти ключи, поэтому второй
 * таблицы соответствий не нужно.
 */
export function taskLinkField(link: TaskLinkRef): string {
  if ('orderId' in link) return 'linkedOrderId';
  if ('organizationId' in link) return 'linkedOrganizationId';
  if ('leadId' in link) return 'linkedLeadId';
  if ('dealId' in link) return 'linkedDealId';
  if ('contactId' in link) return 'linkedContactId';
  if ('dialogId' in link) return 'linkedDialogId';
  return 'linkedDocumentId';
}

/** Значение идентификатора внутри ссылки. */
export function taskLinkValue(link: TaskLinkRef): string {
  return Object.values(link)[0] as string;
}
