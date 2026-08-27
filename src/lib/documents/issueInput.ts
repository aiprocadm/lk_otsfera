import { z } from 'zod';
import type { GenerateArgs } from '@/lib/services/documents/generate';

/**
 * Вход формы выпуска документа (`У-147`) — одна схема на два входа: серверное
 * действие «Выпустить» и роут предпросмотра. Разъедься они, предпросмотр
 * показывал бы не тот документ, который потом выпустится.
 *
 * Схема проверяет **только форму** входа (§3): что это строки, что дата
 * похожа на дату. Доменные правила — полнота реквизитов, допустимость
 * основания, сверка сумм — живут в сервисе и отвечают своими кодами.
 */

const lineSchema = z.object({
  title: z.string().min(1).max(500),
  quantity: z.string().max(32),
  unit: z.enum(['person', 'piece', 'service', 'hour', 'month']),
  unitPrice: z.string().max(32),
  discountPercent: z.string().max(32).nullable(),
  vatRate: z.string().max(32).nullable(),
  vatIncluded: z.boolean(),
});

export const issueInputSchema = z.object({
  orderId: z.string().min(1),
  docType: z.enum(['invoice', 'act', 'contract', 'extra_agreement']),
  /** Строки формы; пусто — берётся состав заказа. */
  lines: z.array(lineSchema).max(200).optional(),
  onAmountMismatch: z.enum(['update_order', 'keep_order']).optional(),
  documentDate: z.string().max(40).optional(),
  subject: z.string().max(500).optional(),
  validUntil: z.string().max(40).optional(),
  paymentTerms: z.string().max(4000).optional(),
  changeText: z.string().max(8000).optional(),
  periodFrom: z.string().max(40).optional(),
  periodTo: z.string().max(40).optional(),
  parentDocumentId: z.string().max(64).optional(),
});

export type IssueInput = z.infer<typeof issueInputSchema>;

/** «2026-08-27» → Date; мусор и пустая строка → «поля нет». */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Вход формы → аргументы сервиса. Условные спреды здесь обязательны:
 * `exactOptionalPropertyTypes` различает «поля нет» и «поле undefined», а
 * сервис по отсутствию поля выбирает поведение по умолчанию.
 */
export function toGenerateArgs(input: IssueInput): GenerateArgs {
  const documentDate = parseDate(input.documentDate);
  const validUntil = parseDate(input.validUntil);
  const periodFrom = parseDate(input.periodFrom);
  const periodTo = parseDate(input.periodTo);
  const extras = {
    ...(documentDate ? { documentDate } : {}),
    ...(validUntil ? { validUntil } : {}),
    ...(periodFrom ? { periodFrom } : {}),
    ...(periodTo ? { periodTo } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.paymentTerms ? { paymentTerms: input.paymentTerms } : {}),
    ...(input.changeText ? { changeText: input.changeText } : {}),
    ...(input.parentDocumentId ? { parentDocumentId: input.parentDocumentId } : {}),
  };
  return {
    orderId: input.orderId,
    docType: input.docType,
    ...(input.lines && input.lines.length > 0 ? { lines: input.lines } : {}),
    ...(input.onAmountMismatch ? { onAmountMismatch: input.onAmountMismatch } : {}),
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };
}
