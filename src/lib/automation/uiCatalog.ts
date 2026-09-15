import { AUTOMATION_TRIGGERS } from './catalog';
import { renderAutomationText } from './templates';

/**
 * То, что нужно ФОРМЕ правила (`У-222`) — и ничего больше.
 *
 * Отдельный модуль, потому что форма это `'use client'`: тянуть в браузер
 * каталог вместе с путями файлов-якорей и служебными полями не нужно, а
 * случайный импорт серверного соседа однажды уронил бы сборку (так уже было с
 * `channels.ts` мессенджеров — `next build` падал на `node:crypto`, и `test:unit`
 * этого не ловил).
 */

/** Список событий для выпадающего списка — подпись и пояснение, без путей. */
export const AUTOMATION_TRIGGER_OPTIONS = Object.entries(AUTOMATION_TRIGGERS).map(
  ([key, spec]) => ({
    key,
    labelRu: spec.labelRu,
    hintRu: spec.hintRu,
  })
);

/** Что можно подставить в текст — по-русски, а не списком машинных ключей. */
export const AUTOMATION_PLACEHOLDER_HINTS = [
  { token: 'document.number', labelRu: 'номер документа' },
  { token: 'document.type', labelRu: 'вид документа' },
  { token: 'order.number', labelRu: 'номер заказа' },
  { token: 'order.title', labelRu: 'название заказа' },
  { token: 'organization.name', labelRu: 'название организации' },
  { token: 'lead.subject', labelRu: 'тема лида' },
  { token: 'deal.title', labelRu: 'название сделки' },
  { token: 'amount', labelRu: 'сумма' },
  { token: 'manager.name', labelRu: 'имя менеджера' },
] as const;

/**
 * Пример события для предпросмотра. Значения нарочно узнаваемые: человек
 * должен увидеть готовую фразу, а не `{{document.number}}`, и понять, что
 * именно подставится. Без предпросмотра узнать это можно было бы только
 * дождавшись настоящего срабатывания.
 */
const SAMPLE = {
  documentNumber: 'С-2026-17',
  documentType: 'счёт',
  orderNumber: 'З-2026-41',
  orderTitle: 'Обучение по промбезопасности',
  organizationName: 'ООО «Ромашка»',
  leadSubject: 'Запрос на обучение',
  dealTitle: 'Ромашка — обучение 12 человек',
  amount: 148_000,
  managerName: 'Иван Петров',
};

/** Подставить в текст правила пример данных. */
export function previewAutomationText(text: string): string {
  return renderAutomationText(text, SAMPLE);
}
