import type { TaskStatus } from '@prisma/client';
import type { BitrixTask } from '../source';
import { persistStageId, type TargetStage } from './stages';
import type { MappingContext, Plan, PlanBefore } from './types';

/**
 * Задача Битрикса → `Task` (`У-191`, спека §3.3).
 *
 * Куда положить задачу, решает таблица «статус портала → колонка ЛК» из
 * предпросмотра; статус задачи берётся из якоря колонки. Отложенная задача
 * (статус 6) в ЛК кладётся в первую колонку с пометкой в описании: отдельного
 * «отложено» в модели нет, а терять этот факт нельзя — по нему видно, почему
 * задача висит.
 *
 * Привязки к CRM переносятся по `bitrixId`: организация, сделка и лид. Контакт
 * привязывается через свою организацию — поле `linkedContactId` появится в
 * этапе 4, и до него задача указывает на организацию контакта.
 */
export type TaskData = {
  companyId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  columnId: string | null;
  createdById: string;
  assigneeIds: string[];
  dueDate: Date | null;
  completedAt: Date | null;
  linkedOrganizationId: string | null;
  linkedDealId: string | null;
  linkedLeadId: string | null;
  bitrixId: string;
};

export type ExistingTask = {
  id: string;
  title: string;
  status: TaskStatus;
  columnId: string | null;
  completedAt: Date | null;
};

export type TaskLookup = {
  byBitrixId: (bitrixId: string) => ExistingTask | undefined;
  organizationByBitrixId: (bitrixId: string) => string | undefined;
  dealByBitrixId: (bitrixId: string) => string | undefined;
  leadByBitrixId: (bitrixId: string) => string | undefined;
  contactOrganization: (bitrixId: string) => string | undefined;
};

export const DEFERRED_NOTE = 'Отложена в Битрикс24';

export function planTask(
  task: BitrixTask,
  ctx: MappingContext,
  lookup: TaskLookup,
  columns: readonly TargetStage[]
): Plan<TaskData> {
  const columnId = ctx.tables.taskColumnMap[String(task.status)] ?? null;
  const column = columnId ? columns.find((c) => c.id === columnId) : undefined;
  if (!column) {
    return { action: 'conflict', reason: 'stage_not_mapped', hint: `статус задачи ${task.status}` };
  }

  const createdById = ctx.resolveUser(task.createdById) ?? ctx.defaultManagerId ?? ctx.importerId;
  const responsible = ctx.resolveUser(task.responsibleId) ?? ctx.defaultManagerId;

  const links = {
    organization: null as string | null,
    deal: null as string | null,
    lead: null as string | null,
  };
  for (const link of task.crmLinks) {
    if (link.kind === 'company')
      links.organization ??= lookup.organizationByBitrixId(link.id) ?? null;
    else if (link.kind === 'deal') links.deal ??= lookup.dealByBitrixId(link.id) ?? null;
    else if (link.kind === 'lead') links.lead ??= lookup.leadByBitrixId(link.id) ?? null;
    else links.organization ??= lookup.contactOrganization(link.id) ?? null;
  }

  const description = [task.description?.trim() || null, task.status === 6 ? DEFERRED_NOTE : null]
    .filter(Boolean)
    .join('\n\n');

  const data: TaskData = {
    companyId: ctx.companyId,
    title: task.title.trim() || `Задача Битрикс24 #${task.id}`,
    description: description || null,
    status: column.statusAnchor as TaskStatus,
    columnId: persistStageId(column.id),
    createdById,
    assigneeIds: responsible ? [responsible] : [],
    dueDate: task.deadline,
    completedAt: task.status === 5 ? task.closedAt : null,
    linkedOrganizationId: links.organization,
    linkedDealId: links.deal,
    linkedLeadId: links.lead,
    bitrixId: task.id,
  };

  const existing = lookup.byBitrixId(task.id);
  if (!existing) return { action: 'create', data };

  const patch: Partial<TaskData> = {};
  const before: PlanBefore<TaskData> = {};
  if (data.title !== existing.title) {
    patch.title = data.title;
    before.title = existing.title;
  }
  if (data.status !== existing.status) {
    patch.status = data.status;
    patch.columnId = data.columnId;
    patch.completedAt = data.completedAt;
    before.status = existing.status;
    before.columnId = existing.columnId;
    // Дата завершения гасится вместе со статусом — снимок обязателен для отката.
    before.completedAt = existing.completedAt;
  }
  if (Object.keys(patch).length === 0) return { action: 'skip', reason: 'no_changes' };
  return { action: 'update', id: existing.id, data: patch, before };
}
