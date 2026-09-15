import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AUTOMATION_TRIGGERS, type AutomationTriggerKey } from '@/lib/automation/catalog';
import { conditionsSchema, type AutomationConditions } from '@/lib/automation/conditions';
import {
  actionsSchema,
  checkActionTemplates,
  type AutomationAction,
} from '@/lib/automation/actions';

/**
 * Правила автоматизации — чтение и правка (`У-222`, `У-224`).
 *
 * Сервис намеренно ничего не знает про кабинеты и сессии: область действия
 * (какой компании правило) выбирает server-action по роли, а сюда приходит
 * готовый `companyId`. Так руководитель одной компании не сможет прислать в
 * форме чужой идентификатор.
 */

export type AutomationRuleError =
  'not_found' | 'validation' | 'unknown_trigger' | 'unknown_placeholder';

export type AutomationRuleView = {
  id: string;
  name: string;
  isActive: boolean;
  isBuiltin: boolean;
  trigger: AutomationTriggerKey;
  triggerLabel: string;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  updatedAt: Date;
  /** Сколько раз правило срабатывало и когда в последний раз. */
  runsTotal: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
};

const ruleInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trigger: z.string().trim().min(1),
  conditions: conditionsSchema.optional(),
  actions: actionsSchema,
});

export type AutomationRuleInput = z.input<typeof ruleInputSchema>;

/** Список правил компании со сводкой по журналу срабатываний. */
export async function listAutomationRules(
  prisma: PrismaClient,
  companyId: string
): Promise<AutomationRuleView[]> {
  const rows = await prisma.automationRule.findMany({
    where: { companyId },
    orderBy: [{ isBuiltin: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      isActive: true,
      isBuiltin: true,
      trigger: true,
      conditions: true,
      actions: true,
      updatedAt: true,
      _count: { select: { runs: true } },
      // Последнее срабатывание — одной выборкой вместе со списком: иначе
      // страница делала бы запрос на каждое правило.
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, status: true },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    isBuiltin: r.isBuiltin,
    trigger: r.trigger as AutomationTriggerKey,
    triggerLabel: triggerLabel(r.trigger),
    conditions: conditionsSchema.safeParse(r.conditions ?? {}).data ?? {},
    actions: actionsSchema.safeParse(r.actions).data ?? [],
    updatedAt: r.updatedAt,
    runsTotal: r._count.runs,
    lastRunAt: r.runs[0]?.createdAt ?? null,
    lastRunStatus: r.runs[0]?.status ?? null,
  }));
}

/**
 * Подпись события. Правило могло сохраниться со старым ключом (событие убрали
 * из каталога) — тогда показываем сам ключ, а не пустоту: человек должен
 * видеть, что правило ссылается на исчезнувшее событие.
 */
function triggerLabel(trigger: string): string {
  const spec = AUTOMATION_TRIGGERS[trigger as AutomationTriggerKey] as
    { labelRu: string } | undefined;
  return spec?.labelRu ?? `Неизвестное событие (${trigger})`;
}

export type SaveRuleOutcome =
  { ok: true; id: string } | { ok: false; error: AutomationRuleError; unknown?: string[] };

/** Создать правило. Новое правило всегда ВЫКЛЮЧЕНО: включают его галочкой. */
export async function createAutomationRule(
  prisma: PrismaClient,
  args: { companyId: string; authorId: string; input: AutomationRuleInput }
): Promise<SaveRuleOutcome> {
  const parsed = ruleInputSchema.safeParse(args.input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  if (!(parsed.data.trigger in AUTOMATION_TRIGGERS)) {
    return { ok: false, error: 'unknown_trigger' };
  }
  // Неизвестная подстановка — отказ сохранить, а не пустота в готовой задаче
  // (§9 пакета): человек, написавший `{{order.nomer}}`, узнаёт об этом сразу.
  const templates = checkActionTemplates(parsed.data.actions);
  if (!templates.ok) return { ok: false, error: 'unknown_placeholder', unknown: templates.unknown };

  const created = await prisma.automationRule.create({
    data: {
      companyId: args.companyId,
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      conditions: parsed.data.conditions ?? {},
      actions: parsed.data.actions,
      createdById: args.authorId,
      updatedBy: args.authorId,
      isActive: false,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Изменить правило. Встроенное править МОЖНО — текст правил из коробки правится (`У-224`). */
export async function updateAutomationRule(
  prisma: PrismaClient,
  args: { companyId: string; authorId: string; ruleId: string; input: AutomationRuleInput }
): Promise<SaveRuleOutcome> {
  const parsed = ruleInputSchema.safeParse(args.input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  if (!(parsed.data.trigger in AUTOMATION_TRIGGERS)) {
    return { ok: false, error: 'unknown_trigger' };
  }
  const templates = checkActionTemplates(parsed.data.actions);
  if (!templates.ok) return { ok: false, error: 'unknown_placeholder', unknown: templates.unknown };

  // Граница компании — в самом запросе: чужое правило неотличимо от
  // несуществующего.
  const existing = await prisma.automationRule.findFirst({
    where: { id: args.ruleId, companyId: args.companyId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };

  await prisma.automationRule.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      conditions: parsed.data.conditions ?? {},
      actions: parsed.data.actions,
      updatedBy: args.authorId,
    },
  });
  return { ok: true, id: existing.id };
}

/**
 * Включить или выключить правило.
 *
 * При ВКЛЮЧЕНИИ записывается тот, кто включил, — если автора ещё нет. Это не
 * формальность: автор правила становится создателем задач, которые правило
 * поставит (`Р-Э4-4`). У правил из коробки автора нет до первого включения, и
 * без этой записи процессор не смог бы создать задачу.
 */
export async function toggleAutomationRule(
  prisma: PrismaClient,
  args: { companyId: string; authorId: string; ruleId: string; isActive: boolean }
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const rule = await prisma.automationRule.findFirst({
    where: { id: args.ruleId, companyId: args.companyId },
    select: { id: true, createdById: true },
  });
  if (!rule) return { ok: false, error: 'not_found' };

  await prisma.automationRule.update({
    where: { id: rule.id },
    data: {
      isActive: args.isActive,
      updatedBy: args.authorId,
      ...(args.isActive && !rule.createdById ? { createdById: args.authorId } : {}),
    },
  });
  return { ok: true };
}

/**
 * Удалить правило.
 *
 * Правило из коробки не удаляется — его выключают. Иначе список «правил из
 * коробки» у одной компании отличался бы от другой, и объяснить, почему у
 * соседа есть правило, которого нет здесь, было бы нечем.
 */
export async function deleteAutomationRule(
  prisma: PrismaClient,
  args: { companyId: string; ruleId: string }
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'builtin' }> {
  const rule = await prisma.automationRule.findFirst({
    where: { id: args.ruleId, companyId: args.companyId },
    select: { id: true, isBuiltin: true },
  });
  if (!rule) return { ok: false, error: 'not_found' };
  if (rule.isBuiltin) return { ok: false, error: 'builtin' };

  await prisma.automationRule.delete({ where: { id: rule.id } });
  return { ok: true };
}

export type AutomationRunView = {
  id: string;
  at: Date;
  ruleName: string;
  status: string;
  error: string | null;
  createdTasks: number;
  notified: number;
};

/** Сколько строк журнала показывает экран; полная история — в базе. */
const AUTOMATION_RUNS_CAP = 50;

/** Журнал срабатываний компании (`У-223`). */
export async function listAutomationRuns(
  prisma: PrismaClient,
  companyId: string
): Promise<AutomationRunView[]> {
  const rows = await prisma.automationRun.findMany({
    where: { companyId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUTOMATION_RUNS_CAP,
    select: {
      id: true,
      createdAt: true,
      status: true,
      error: true,
      createdTaskIds: true,
      notifiedUserIds: true,
      rule: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    ruleName: r.rule.name,
    status: r.status,
    error: r.error,
    createdTasks: r.createdTaskIds.length,
    notified: r.notifiedUserIds.length,
  }));
}
