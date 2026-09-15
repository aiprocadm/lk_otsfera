import { applyPlaceholders, findUnknownPlaceholders } from '@/lib/templates/placeholders';
import type { AutomationEventPayload } from './conditions';

/**
 * Подстановки в текстах правил (`У-222`, `У-224`).
 *
 * Движок общий с шаблонами писем и ответов (`lib/templates/placeholders`) —
 * второй синтаксис ради роботов заводить не стали. Здесь только список того,
 * что правило вправе подставить, и сборка значений из данных события.
 *
 * Неизвестная подстановка — **ошибка сохранения правила** (§9 пакета), а не
 * тихая пустота в готовой задаче. Человек, который написал `{{order.nomer}}`,
 * должен узнать об этом сразу, а не через неделю, увидев задачу с этим текстом.
 */

/** Что можно подставить в название и описание задачи, в текст уведомления. */
const AUTOMATION_PLACEHOLDERS = [
  'order.number',
  'order.title',
  'organization.name',
  'document.number',
  'document.type',
  'lead.subject',
  'deal.title',
  'amount',
  'manager.name',
] as const;

type AutomationPlaceholder = (typeof AUTOMATION_PLACEHOLDERS)[number];

/** Проверка при сохранении правила: все ли подстановки известны. */
export function checkAutomationPlaceholders(
  ...texts: string[]
): { ok: true } | { ok: false; unknown: string[] } {
  return findUnknownPlaceholders(AUTOMATION_PLACEHOLDERS, ...texts);
}

/**
 * Значения подстановок из данных события.
 *
 * Чего в событии нет — подставляется прочерком, а НЕ остаётся как
 * `{{document.number}}`: служебный код на экране человека это дефект
 * понятности (§15). Сам факт «данных не было» виден в журнале срабатываний.
 */
function automationValues(payload: AutomationEventPayload): Map<string, string> {
  const values = new Map<string, string>();
  const put = (key: AutomationPlaceholder, value: unknown): void => {
    if (typeof value === 'string' && value.trim()) values.set(key, value.trim());
    else if (typeof value === 'number' && Number.isFinite(value)) values.set(key, String(value));
    else values.set(key, '—');
  };
  put('order.number', payload.orderNumber);
  put('order.title', payload.orderTitle);
  put('organization.name', payload.organizationName);
  put('document.number', payload.documentNumber);
  put('document.type', payload.documentType);
  put('lead.subject', payload.leadSubject);
  put('deal.title', payload.dealTitle);
  put('amount', payload.amount);
  put('manager.name', payload.managerName);
  return values;
}

/** Подставить значения в текст правила. */
export function renderAutomationText(text: string, payload: AutomationEventPayload): string {
  return applyPlaceholders(text, automationValues(payload));
}
