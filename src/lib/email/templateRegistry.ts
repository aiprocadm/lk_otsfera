import type { EmailTemplateKey } from '@/lib/notifications/channels/types';

/**
 * Реестр шаблонов писем: какие подстановки допустимы в каждом (`У-128`).
 *
 * **Зачем реестр, а не «подставим что найдём».** Неизвестная подстановка — это
 * ошибка сохранения, а не пустое место в письме. Требование говорит об этом
 * прямо, и причина понятна: письмо с дырой вместо номера заказа хуже, чем
 * отказ сохранить.
 *
 * **Подстановка — это пара «понятное имя → поле данных».** В письме человек
 * пишет `{{order.number}}`, а в данных лежит `orderNumber`: имена полей
 * писались программистами и наружу не годятся.
 *
 * **Стандартного текста здесь НЕТ.** Пустое переопределение означает «письмо
 * собирает программа, как раньше». Держать копию стандартного текста рядом с
 * самим шаблоном значило бы завести вторую версию правды, которая разъедется
 * при первой же правке вёрстки.
 */

export type TemplatePlaceholder = {
  /** Как пишется в тексте письма. */
  token: string;
  /** Поле в данных письма. */
  prop: string;
  /** Что это, по-русски — показывается рядом с редактором. */
  label: string;
};

export type EmailTemplateSpec = {
  /** Название письма для человека. */
  label: string;
  placeholders: TemplatePlaceholder[];
};

const ORDER: TemplatePlaceholder[] = [
  { token: 'order.number', prop: 'orderNumber', label: 'Номер заказа' },
  { token: 'order.title', prop: 'orderTitle', label: 'Название заказа' },
  { token: 'order.url', prop: 'orderUrl', label: 'Ссылка на заказ' },
];

const ORG: TemplatePlaceholder = {
  token: 'organization.name',
  prop: 'organizationName',
  label: 'Название организации',
};

const DOC: TemplatePlaceholder[] = [
  { token: 'document.name', prop: 'documentName', label: 'Название документа' },
  { token: 'document.type', prop: 'documentType', label: 'Тип документа' },
];

export const EMAIL_TEMPLATE_REGISTRY: Record<EmailTemplateKey, EmailTemplateSpec> = {
  notification: {
    label: 'Общее уведомление',
    placeholders: [
      { token: 'title', prop: 'title', label: 'Заголовок' },
      { token: 'body', prop: 'body', label: 'Текст' },
      { token: 'url', prop: 'url', label: 'Ссылка' },
      { token: 'recipient.name', prop: 'recipientName', label: 'Имя получателя' },
    ],
  },
  orgDocumentPublished: {
    label: 'Заказчику: опубликован документ',
    placeholders: [ORG, ...ORDER, ...DOC],
  },
  orgDocumentSent: {
    label: 'Заказчику: документ отправлен письмом',
    placeholders: [
      ORG,
      { token: 'document.name', prop: 'documentName', label: 'Название документа' },
      { token: 'document.type', prop: 'documentType', label: 'Тип документа' },
      { token: 'document.number', prop: 'documentNumber', label: 'Номер документа' },
      { token: 'document.url', prop: 'documentUrl', label: 'Ссылка на документ' },
      { token: 'order.number', prop: 'orderNumber', label: 'Номер заказа' },
      { token: 'order.title', prop: 'orderTitle', label: 'Название заказа' },
    ],
  },
  orgPaymentReceived: {
    label: 'Заказчику: поступила оплата',
    placeholders: [
      ORG,
      ...ORDER,
      { token: 'payment.amount', prop: 'amount', label: 'Сумма' },
      { token: 'payment.paidAt', prop: 'paidAt', label: 'Дата оплаты' },
    ],
  },
  orgManagerReplied: {
    label: 'Заказчику: менеджер ответил',
    placeholders: [
      ORG,
      ...ORDER,
      { token: 'comment.body', prop: 'commentBody', label: 'Текст ответа' },
      { token: 'manager.name', prop: 'managerName', label: 'Имя менеджера' },
    ],
  },
  orgOrderStatusChanged: {
    label: 'Заказчику: изменился статус заказа',
    placeholders: [
      ORG,
      ...ORDER,
      { token: 'status.old', prop: 'oldStatus', label: 'Прежний статус' },
      { token: 'status.new', prop: 'newStatus', label: 'Новый статус' },
    ],
  },
  managerCommentFromOrg: {
    label: 'Менеджеру: комментарий от заказчика',
    placeholders: [
      ORG,
      ...ORDER,
      { token: 'comment.body', prop: 'commentBody', label: 'Текст комментария' },
    ],
  },
  managerDocumentUploadedByOrg: {
    label: 'Менеджеру: заказчик загрузил документ',
    placeholders: [ORG, ...ORDER, ...DOC],
  },
  managerDocumentUploadedByPartner: {
    label: 'Менеджеру: партнёр загрузил документ',
    placeholders: [
      { token: 'partner.name', prop: 'partnerName', label: 'Название партнёра' },
      ...ORDER,
      ...DOC,
    ],
  },
  managerOrderMarkedPaidBy1C: {
    label: 'Менеджеру: 1С отметила оплату',
    placeholders: [
      ...ORDER,
      { token: 'payment.amount', prop: 'amount', label: 'Сумма' },
      { token: 'payment.paidAt', prop: 'paidAt', label: 'Дата оплаты' },
    ],
  },
  managerOrderStatusChanged: {
    label: 'Менеджеру: изменился статус заказа',
    placeholders: [
      ...ORDER,
      { token: 'status.old', prop: 'oldStatus', label: 'Прежний статус' },
      { token: 'status.new', prop: 'newStatus', label: 'Новый статус' },
      { token: 'actor.name', prop: 'actorName', label: 'Кто изменил' },
    ],
  },
  partnerDocumentPublished: {
    label: 'Партнёру: опубликован документ',
    placeholders: [
      { token: 'partner.name', prop: 'partnerName', label: 'Название партнёра' },
      ...ORDER,
      ...DOC,
    ],
  },
  commissionReady: {
    label: 'Партнёру: готов комиссионный отчёт',
    placeholders: [
      { token: 'partner.name', prop: 'partnerName', label: 'Название партнёра' },
      { token: 'period.from', prop: 'periodFrom', label: 'Период с' },
      { token: 'period.to', prop: 'periodTo', label: 'Период по' },
      { token: 'amount', prop: 'amount', label: 'Сумма' },
      { token: 'statement.url', prop: 'statementUrl', label: 'Ссылка на отчёт' },
    ],
  },
};

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return Object.hasOwn(EMAIL_TEMPLATE_REGISTRY, value);
}

/** Все подстановки, встреченные в тексте. */
export function extractTokens(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]!);
}

export type ValidateResult = { ok: true } | { ok: false; unknown: string[] };

/**
 * Проверка подстановок.
 *
 * Неизвестная подстановка — отказ сохранить, а не пустое место в письме
 * (`У-128`). Проверяем **обе** части письма: тему и текст, иначе опечатка в
 * теме прошла бы незамеченной.
 */
export function validateTemplateText(key: EmailTemplateKey, ...texts: string[]): ValidateResult {
  const allowed = new Set(EMAIL_TEMPLATE_REGISTRY[key].placeholders.map((p) => p.token));
  const unknown = [...new Set(texts.flatMap(extractTokens))].filter((t) => !allowed.has(t));
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

/**
 * Подстановка значений.
 *
 * Пустое или отсутствующее значение заменяется прочерком, а не пустотой:
 * «Заказ —» читается как «номера нет», а «Заказ » выглядит как обрыв письма.
 */
export function renderTemplateText(
  key: EmailTemplateKey,
  text: string,
  props: Record<string, unknown>
): string {
  const byToken = new Map(EMAIL_TEMPLATE_REGISTRY[key].placeholders.map((p) => [p.token, p.prop]));
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, token: string) => {
    const prop = byToken.get(token);
    if (!prop) return whole; // до сюда не доходит: сохранение уже отказало
    const value = props[prop];
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  });
}
