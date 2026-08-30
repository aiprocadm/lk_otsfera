import type { EmailTemplateKey } from '@/lib/notifications/channels/types';
import {
  applyPlaceholders,
  extractPlaceholders,
  findUnknownPlaceholders,
  type TemplatePlaceholder,
} from '@/lib/templates/placeholders';

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

/**
 * Подстановка. Тип общий с текстами документов (`У-160`): механика поиска и
 * замены живёт в `lib/templates/placeholders`, а здесь остаётся то, что
 * относится именно к письмам — список допустимых подстановок и правило
 * «пустое значение → прочерк».
 */
export type { TemplatePlaceholder };

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
  return extractPlaceholders(text);
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
  return findUnknownPlaceholders(
    EMAIL_TEMPLATE_REGISTRY[key].placeholders.map((p) => p.token),
    ...texts
  );
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
  // Прочерки расставляются ЗДЕСЬ, а не в общем движке: правило «пусто —
  // прочерк» придумано для письма и в договор не переезжает («действует до —»
  // означало бы бумагу без срока).
  const values = new Map<string, string>();
  for (const p of EMAIL_TEMPLATE_REGISTRY[key].placeholders) {
    const value = props[p.prop];
    values.set(
      p.token,
      value === null || value === undefined || value === '' ? '—' : String(value)
    );
  }
  return applyPlaceholders(text, values);
}
