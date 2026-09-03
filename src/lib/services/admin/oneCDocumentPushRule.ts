import type { DocumentType, OneCDocumentPushMode, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { ONE_C_PUSHABLE_TYPES } from '@/lib/services/oneCSync/schemas';
import { guardCompany } from './companyBranding';

/**
 * Этап 8 (`У-169`): правило выгрузки документов в 1С — у каждой компании
 * своё. Два поля `Company`: когда выгружать (`auto` — сразу после выпуска,
 * `manual` — только по кнопке, `never` — никогда) и какие типы уезжают.
 *
 * Читается вместе с реквизитами (`listCompaniesRequisites`) — правило живёт
 * на том же экране «Реквизиты исполнителя», что налоги и нумерация; здесь
 * только запись. Граница компании — `guardCompany` (`Р-22`): админ правит
 * любую, руководитель — свою, менеджеру отказ.
 *
 * Набор типов ограничен ЧЕТЫРЬМЯ (`ONE_C_PUSHABLE_TYPES`): КП в 1С не
 * выгружается (`Р-14`). База держит то же ограничение проверкой
 * `Company_oneCDocumentPushTypes_pushable`, но отвечать человеку обязан код —
 * кодом `invalid_types`, а не ошибкой базы.
 */

const MODES = ['auto', 'manual', 'never'] as const satisfies readonly OneCDocumentPushMode[];

export type OneCDocumentPushRuleInput = {
  /** Сырые строки формы: проверяются здесь, а не в action. */
  mode: string;
  types: string[];
};

export type OneCDocumentPushRuleResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid_mode' | 'invalid_types' };

function isMode(value: string): value is OneCDocumentPushMode {
  return (MODES as readonly string[]).includes(value);
}

function isPushableType(value: string): value is DocumentType {
  return (ONE_C_PUSHABLE_TYPES as readonly string[]).includes(value);
}

export async function updateOneCDocumentPushRule(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: OneCDocumentPushRuleInput
): Promise<OneCDocumentPushRuleResult> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  if (!isMode(input.mode)) return { ok: false, error: 'invalid_mode' };
  if (!input.types.every(isPushableType)) return { ok: false, error: 'invalid_types' };
  // Порядок и повторы формы не важны: храним канонический набор — иначе два
  // одинаковых правила выглядели бы в журнале как разные.
  const types = ONE_C_PUSHABLE_TYPES.filter((t) => input.types.includes(t));

  const before = await prisma.company.findUnique({
    where: { id: companyId },
    select: { oneCDocumentPushMode: true, oneCDocumentPushTypes: true },
  });
  if (!before) return { ok: false, error: 'not_found' };
  await prisma.company.update({
    where: { id: companyId },
    data: { oneCDocumentPushMode: input.mode, oneCDocumentPushTypes: types },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'company_onec_push_rule_changed',
    entity: 'company',
    entityId: companyId,
    before: { mode: before.oneCDocumentPushMode, types: before.oneCDocumentPushTypes },
    after: { mode: input.mode, types },
  });
  return { ok: true };
}
