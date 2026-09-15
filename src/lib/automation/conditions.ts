import { z } from 'zod';

/**
 * Условия правила (`У-222`) — «если … то». Их немного и они нарочно простые:
 * заказчик просил короткие правила без графического редактора (`01` §4).
 *
 * Пустой объект — «без условий», правило срабатывает на каждое своё событие.
 * Неизвестное поле условия отбраковывается при СОХРАНЕНИИ правила, а не молча
 * игнорируется на срабатывании: правило, которое тихо не работает, хуже
 * правила, которое отказались сохранить.
 */

export const conditionsSchema = z
  .object({
    /** Только эти организации. Пусто/нет — любые. */
    organizationIdIn: z.array(z.string().min(1)).optional(),
    /** Сумма объекта не меньше указанной (рубли). */
    amountGte: z.number().finite().nonnegative().optional(),
    /** Есть ли партнёр: `true` — только партнёрские, `false` — только прямые. */
    hasPartner: z.boolean().optional(),
    /** Источник обращения (`website`, `organization_cabinet`, …). */
    source: z.string().min(1).optional(),
    /** Целевой статус/стадия — для событий смены статуса. */
    toStatus: z.string().min(1).optional(),
  })
  .strict();

export type AutomationConditions = z.infer<typeof conditionsSchema>;

/** Данные события, по которым проверяются условия. */
export type AutomationEventPayload = {
  organizationId?: string | null;
  amount?: number | null;
  partnerId?: string | null;
  source?: string | null;
  toStatus?: string | null;
  /** Ответственный менеджер объекта — нужен действиям, не условиям. */
  responsibleManagerId?: string | null;
  /** Всё остальное для подстановок в текст. */
  [key: string]: unknown;
};

/**
 * Подходит ли событие под условия правила.
 *
 * Неизвестное поле в `conditions` сюда не попадает (его отбраковал Zod при
 * сохранении), а отсутствующее в событии значение считается НЕСОВПАДЕНИЕМ, а не
 * совпадением: «сумма не меньше 100 000» при неизвестной сумме — это «не знаю»,
 * и запускать робота на «не знаю» нельзя.
 */
export function matchesConditions(
  conditions: AutomationConditions,
  payload: AutomationEventPayload
): boolean {
  if (conditions.organizationIdIn && conditions.organizationIdIn.length > 0) {
    if (!payload.organizationId) return false;
    if (!conditions.organizationIdIn.includes(payload.organizationId)) return false;
  }
  if (conditions.amountGte !== undefined) {
    if (typeof payload.amount !== 'number') return false;
    if (payload.amount < conditions.amountGte) return false;
  }
  if (conditions.hasPartner !== undefined) {
    const has = !!payload.partnerId;
    if (has !== conditions.hasPartner) return false;
  }
  if (conditions.source !== undefined) {
    if (payload.source !== conditions.source) return false;
  }
  if (conditions.toStatus !== undefined) {
    if (payload.toStatus !== conditions.toStatus) return false;
  }
  return true;
}
