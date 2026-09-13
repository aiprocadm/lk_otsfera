import type { Prisma } from '@prisma/client';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';
import type { ContactData } from '../mapping/contacts';
import type { DealData } from '../mapping/deals';
import type { LeadData } from '../mapping/leads';
import type { OrganizationData } from '../mapping/organizations';
import type { TaskData } from '../mapping/tasks';
import type { DealNoteData, OrganizationNoteData } from '../mapping/notes';
import type { BitrixEntity, Plan } from '../mapping/types';
import { hasChanges, mergeUpdate, type FieldMap } from '../idempotency';
import { snapshot, writeJournal, type ApplyContext, type Tx, type WriteOutcome } from './journal';

/**
 * Писатели сущностей (`У-194`, спека §3.2).
 *
 * Пишем НАПРЯМУЮ через транзакцию, а не штатными сервисами кабинета. Три
 * причины: штатный `createTask` разослал бы уведомления исполнителям (при
 * переносе истории это сотни писем), сервисы не принимают транзакцию, и они
 * не дают выставить `bitrixId`, исторические даты и стадии из таблиц
 * сопоставления.
 *
 * Каждый писатель делает ровно одно: пишет строку и журнал в одной
 * транзакции. Решение «что писать» принято раньше, в `mapping/*`.
 */
type PlanOf<T> = Plan<T>;

/** Общая часть обновления: правило §3.4 поверх уже посчитанного плана. */
async function applyUpdate<T extends FieldMap>(
  tx: Tx,
  ctx: ApplyContext,
  entity: BitrixEntity,
  plan: Extract<PlanOf<T>, { action: 'update' }>,
  bitrixId: string,
  write: (data: FieldMap) => Promise<void>
): Promise<WriteOutcome | null> {
  const merged = mergeUpdate(
    plan.before as FieldMap,
    plan.data as Partial<FieldMap>,
    ctx.lastAfter(entity, plan.id)
  );
  if (!hasChanges(merged)) {
    // Писать нечего: либо всё совпало, либо всё правлено руками. Строка
    // журнала здесь была бы мусором — откатывать нечего.
    return merged.keptManual.length > 0
      ? { entityId: plan.id, action: 'updated', keptManual: merged.keptManual }
      : null;
  }
  await write(merged.data);
  await writeJournal(tx, ctx, {
    entity,
    entityId: plan.id,
    bitrixId,
    action: 'updated',
    before: merged.before,
    after: merged.after,
  });
  return { entityId: plan.id, action: 'updated', keptManual: merged.keptManual };
}

export async function writeOrganization(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<OrganizationData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action === 'create') {
    const d = plan.data;
    const created = await tx.organization.create({
      data: {
        name: d.name,
        nameKey: d.nameKey,
        inn: d.inn,
        kpp: d.kpp,
        companyId: d.companyId,
        bitrixId: d.bitrixId,
      },
      select: { id: true },
    });
    // Пометка про отсутствующий ИНН — заметка организации: отдельного поля у
    // модели нет, а терять этот факт нельзя (по нему видно, чего ждать от 1С).
    if (d.note) {
      await tx.organizationNote.create({
        data: {
          companyId: d.companyId,
          organizationId: created.id,
          body: d.note,
          authorId: null,
        },
      });
    }
    // Ответственный из Битрикса — менеджер организации; связь отдельная,
    // поэтому пишется здесь же, в одной транзакции со строкой.
    if (d.managerUserId) {
      await tx.organizationManager.create({
        data: { organizationId: created.id, userId: d.managerUserId },
      });
    }
    await writeJournal(tx, ctx, {
      entity: 'organization',
      entityId: created.id,
      bitrixId,
      action: 'created',
      after: snapshot({ name: d.name, inn: d.inn, kpp: d.kpp, bitrixId: d.bitrixId }),
    });
    return { entityId: created.id, action: 'created', keptManual: [] };
  }
  if (plan.action !== 'update') return null;
  return applyUpdate(tx, ctx, 'organization', plan as never, bitrixId, async (data) => {
    // `nameKey` считается из имени всегда: поиск по названию иначе разъедется.
    const patch = { ...data } as Prisma.OrganizationUncheckedUpdateInput;
    if (typeof data.name === 'string') patch.nameKey = organizationNameKey(data.name);
    await tx.organization.update({ where: { id: plan.id }, data: patch });
  });
}

export async function writeContact(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<ContactData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action === 'create') {
    const d = plan.data;
    const created = await tx.contact.create({
      data: {
        companyId: d.companyId,
        organizationId: d.organizationId,
        name: d.name,
        position: d.position,
        bitrixId: d.bitrixId,
        createdById: ctx.importerId,
        channels: {
          create: d.channels.map((ch, i) => ({
            companyId: d.companyId,
            type: ch.type,
            value: ch.value,
            normalizedValue: ch.normalizedValue,
            isPrimary: i === 0,
          })),
        },
      },
      select: { id: true },
    });
    await writeJournal(tx, ctx, {
      entity: 'contact',
      entityId: created.id,
      bitrixId,
      action: 'created',
      after: snapshot({ name: d.name, position: d.position, organizationId: d.organizationId }),
    });
    return { entityId: created.id, action: 'created', keptManual: [] };
  }
  if (plan.action !== 'update') return null;

  // Каналы дописываются отдельно: это не поле карточки, а способ найти
  // человека, и правило «правленное не трогаем» к ним неприменимо.
  const channels = plan.data.channels ?? [];
  const outcome = await applyUpdate(tx, ctx, 'contact', plan as never, bitrixId, async (data) => {
    const patch = { ...data };
    delete patch.channels;
    delete patch.skippedChannels;
    if (Object.keys(patch).length > 0) {
      await tx.contact.update({
        where: { id: plan.id },
        data: patch as Prisma.ContactUncheckedUpdateInput,
      });
    }
  });
  for (const ch of channels) {
    await tx.contactChannel.createMany({
      data: [
        {
          contactId: plan.id,
          companyId: ctx.companyId,
          type: ch.type,
          value: ch.value,
          normalizedValue: ch.normalizedValue,
        },
      ],
      skipDuplicates: true,
    });
  }
  return outcome ?? { entityId: plan.id, action: 'updated', keptManual: [] };
}

export async function writeLead(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<LeadData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action === 'create') {
    const d = plan.data;
    const created = await tx.lead.create({
      data: {
        source: d.source,
        status: d.status,
        funnelStageId: d.funnelStageId,
        subject: d.subject,
        clientCompanyName: d.clientCompanyName,
        clientContactName: d.clientContactName,
        clientContactPhone: d.clientContactPhone,
        clientContactEmail: d.clientContactEmail,
        clientInn: d.clientInn,
        ...(d.estimatedAmount ? { estimatedAmount: d.estimatedAmount } : {}),
        organizationId: d.organizationId,
        assignedManagerId: d.assignedManagerId,
        createdByUserId: d.createdByUserId,
        notes: d.notes,
        bitrixId: d.bitrixId,
      },
      select: { id: true },
    });
    await writeJournal(tx, ctx, {
      entity: 'lead',
      entityId: created.id,
      bitrixId,
      action: 'created',
      after: snapshot({ subject: d.subject, status: d.status, funnelStageId: d.funnelStageId }),
    });
    return { entityId: created.id, action: 'created', keptManual: [] };
  }
  if (plan.action !== 'update') return null;
  return applyUpdate(tx, ctx, 'lead', plan as never, bitrixId, async (data) => {
    await tx.lead.update({
      where: { id: plan.id },
      data: data as Prisma.LeadUncheckedUpdateInput,
    });
  });
}

export async function writeDeal(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<DealData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action === 'create') {
    const d = plan.data;
    const created = await tx.deal.create({
      data: {
        companyId: d.companyId,
        title: d.title,
        ...(d.amount ? { amount: d.amount } : {}),
        status: d.status,
        stageId: d.stageId,
        organizationId: d.organizationId,
        contactId: d.contactId,
        leadId: d.leadId,
        managerId: d.managerId,
        expectedCloseAt: d.expectedCloseAt,
        wonAt: d.wonAt,
        lostAt: d.lostAt,
        bitrixId: d.bitrixId,
      },
      select: { id: true },
    });
    // Лид, из которого выросла сделка, должен указывать на неё: без этого
    // «Сконвертирован» в Битриксе превратился бы в лид без продолжения.
    if (d.leadId) {
      await tx.lead.updateMany({
        where: { id: d.leadId, promotedDealId: null },
        data: { promotedDealId: created.id },
      });
    }
    await writeJournal(tx, ctx, {
      entity: 'deal',
      entityId: created.id,
      bitrixId,
      action: 'created',
      after: snapshot({ title: d.title, status: d.status, stageId: d.stageId, wonAt: d.wonAt }),
    });
    return { entityId: created.id, action: 'created', keptManual: [] };
  }
  if (plan.action !== 'update') return null;
  return applyUpdate(tx, ctx, 'deal', plan as never, bitrixId, async (data) => {
    const patch = { ...data };
    delete patch.wantsOrder;
    await tx.deal.update({
      where: { id: plan.id },
      data: patch as Prisma.DealUncheckedUpdateInput,
    });
  });
}

export async function writeDealNote(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<DealNoteData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action !== 'create') return null;
  const d = plan.data;
  const created = await tx.dealNote.create({
    data: {
      dealId: d.dealId,
      body: d.body,
      authorId: d.authorId,
      // Дата оригинала: заметка десятилетней давности не должна выглядеть
      // написанной сегодня — иначе лента сделки врёт о ходе работы.
      ...(d.createdAt ? { createdAt: d.createdAt } : {}),
    },
    select: { id: true },
  });
  await writeJournal(tx, ctx, {
    entity: 'note',
    entityId: created.id,
    bitrixId,
    action: 'created',
    after: snapshot({ dealId: d.dealId, authorId: d.authorId }),
  });
  return { entityId: created.id, action: 'created', keptManual: [] };
}

export async function writeOrganizationNote(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<OrganizationNoteData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action !== 'create') return null;
  const d = plan.data;
  const created = await tx.organizationNote.create({
    data: {
      companyId: d.companyId,
      organizationId: d.organizationId,
      body: d.body,
      authorId: d.authorId,
      ...(d.createdAt ? { createdAt: d.createdAt } : {}),
    },
    select: { id: true },
  });
  await writeJournal(tx, ctx, {
    entity: 'note',
    entityId: created.id,
    bitrixId,
    action: 'created',
    after: snapshot({ organizationId: d.organizationId, authorId: d.authorId }),
  });
  return { entityId: created.id, action: 'created', keptManual: [] };
}

export async function writeTask(
  tx: Tx,
  ctx: ApplyContext,
  plan: PlanOf<TaskData>,
  bitrixId: string
): Promise<WriteOutcome | null> {
  if (plan.action === 'create') {
    const d = plan.data;
    const created = await tx.task.create({
      data: {
        companyId: d.companyId,
        title: d.title,
        description: d.description,
        status: d.status,
        columnId: d.columnId,
        createdById: d.createdById,
        dueDate: d.dueDate,
        completedAt: d.completedAt,
        linkedOrganizationId: d.linkedOrganizationId,
        linkedDealId: d.linkedDealId,
        linkedLeadId: d.linkedLeadId,
        bitrixId: d.bitrixId,
        assignees: { create: d.assigneeIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    await writeJournal(tx, ctx, {
      entity: 'task',
      entityId: created.id,
      bitrixId,
      action: 'created',
      after: snapshot({ title: d.title, status: d.status, columnId: d.columnId }),
    });
    return { entityId: created.id, action: 'created', keptManual: [] };
  }
  if (plan.action !== 'update') return null;
  return applyUpdate(tx, ctx, 'task', plan as never, bitrixId, async (data) => {
    const patch = { ...data };
    delete patch.assigneeIds;
    await tx.task.update({
      where: { id: plan.id },
      data: patch as Prisma.TaskUncheckedUpdateInput,
    });
  });
}
