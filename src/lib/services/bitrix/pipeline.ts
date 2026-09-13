import type { PrismaClient } from '@prisma/client';
import { resolveFunnelStages } from '@/lib/funnel/stages';
import { resolveDealStages } from '@/lib/services/deals/stages';
import { findByAnchor } from '@/lib/services/orderStatuses/definitions';
import { resolveTaskColumns } from '@/lib/tasks/columns';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import {
  channelConflicts,
  planContact,
  type ChannelOwnerRef,
  type ContactChannelData,
  type ContactData,
} from './mapping/contacts';
import { planDeal } from './mapping/deals';
import { planFile } from './mapping/files';
import { planLead } from './mapping/leads';
import {
  channelKey,
  loadCompanyUsers,
  loadContacts,
  loadDeals,
  loadDocuments,
  loadLeads,
  loadOrders,
  loadOrganizations,
  loadTasks,
  organizationKeysOf,
} from './mapping/lookup';
import { planDealNote, planOrganizationNote } from './mapping/notes';
import { planOrderForWonDeal } from './mapping/orders';
import { planOrganization } from './mapping/organizations';
import { BitrixRegistry, isPlanned, plannedId } from './mapping/registry';
import {
  proposeLeadStageMap,
  proposeStageMap,
  proposeTaskColumnMap,
  stageMapComplete,
  type TargetStage,
} from './mapping/stages';
import { planTask } from './mapping/tasks';
import {
  BITRIX_ENTITIES,
  countPlan,
  dealStageKey,
  emptyCounts,
  planReason,
  type BitrixEntity,
  type BitrixMappingTables,
  type EntityCounts,
  type MappingContext,
  type Plan,
  type PlanRow,
  type UserMapRow,
} from './mapping/types';
import { mapUsers } from './mapping/users';
import type { BitrixSource, BitrixStage, SourceFilter } from './source';

/**
 * Конвейер пакета (`У-193`, `У-194`, спека §3.2): один и тот же порядок и одни
 * и те же правила на предпросмотр и на применение.
 *
 * `shadow` — сухой прогон: читает источник, строит планы, считает сводку и
 * конфликты, НИЧЕГО не пишет. `live` (PR-4) пойдёт тем же путём, но будет
 * звать писателей. Разделять их нельзя: предпросмотр, посчитанный другим
 * кодом, рано или поздно разойдётся с тем, что действительно произойдёт.
 *
 * Записи читаются страницами, состояние ЛК — пачкой на страницу
 * (`mapping/lookup.ts`), поэтому размер пакета не превращается в тысячи
 * запросов к базе.
 */
type PipelineMode = 'shadow' | 'live';

/**
 * Прогресс без вранья: сколько записей обработано и чем заняты сейчас. Общего
 * числа у постраничного чтения нет — обещать «сделано из N» было бы неправдой.
 */
export type PipelineProgress = {
  step: BitrixEntity | 'users' | 'stages';
  done: number;
  updatedAt: string;
};

export type PipelineCounts = Record<BitrixEntity, EntityCounts> & {
  progress: PipelineProgress | null;
  total: number;
  warnings: string[];
};

export type PipelineResult = {
  counts: PipelineCounts;
  /** Стадии и статусы портала — из них экран рисует таблицы сопоставления. */
  stagesFound: BitrixStage[];
  usersFound: UserMapRow[];
  /** Предложенные таблицы: сохранённые значения + догадки по названиям. */
  tables: BitrixMappingTables;
  /** Строки конфликтов и пропусков (первые `ROW_CAP`) — их показывает предпросмотр. */
  rows: PlanRow[];
  errors: { bitrixId: string; entity: BitrixEntity; message: string }[];
  ready: boolean;
};

const PAGE_SIZE = 200;
export const ROW_CAP = 500;
export const BIG_BATCH = 50_000;
const PROGRESS_EVERY = 50;

export type PipelineArgs = {
  batch: {
    id: string;
    companyId: string;
    importedById: string;
    filter: SourceFilter;
    withFiles: boolean;
    defaultManagerId: string | null;
    tables: Partial<BitrixMappingTables>;
  };
  source: BitrixSource;
  mode: PipelineMode;
  onProgress?: (progress: PipelineProgress) => Promise<void>;
};

function emptyPipelineCounts(): PipelineCounts {
  const counts = Object.fromEntries(BITRIX_ENTITIES.map((e) => [e, emptyCounts()])) as Record<
    BitrixEntity,
    EntityCounts
  >;
  return { ...counts, progress: null, total: 0, warnings: [] };
}

const asTarget = (s: {
  id: string;
  name: string;
  statusAnchor: string;
  isTerminal: boolean;
}): TargetStage => ({
  id: s.id,
  name: s.name,
  statusAnchor: s.statusAnchor,
  isTerminal: s.isTerminal,
});

/** У колонки задач «конечность» называется иначе — это колонка «готово». */
const asColumnTarget = (c: {
  id: string;
  name: string;
  statusAnchor: string;
  isDoneColumn: boolean;
}): TargetStage => ({
  id: c.id,
  name: c.name,
  statusAnchor: c.statusAnchor,
  isTerminal: c.isDoneColumn,
});

/** Накопитель страниц: отдаёт буфер, как только в нём набралось `size` записей. */
async function* pages<T>(items: AsyncIterable<T>, size = PAGE_SIZE): AsyncIterable<T[]> {
  let buffer: T[] = [];
  for await (const item of items) {
    buffer.push(item);
    if (buffer.length >= size) {
      yield buffer;
      buffer = [];
    }
  }
  if (buffer.length > 0) yield buffer;
}

export async function runPipeline(
  prisma: PrismaClient,
  args: PipelineArgs
): Promise<PipelineResult> {
  if (args.mode === 'live') {
    // PR-4: тот же обход, но с писателями и журналом `BitrixImportWrite`.
    throw new Error('Применение пакета появится следующим шагом этапа');
  }
  const { batch, source } = args;
  const counts = emptyPipelineCounts();
  const rows: PlanRow[] = [];
  const errors: PipelineResult['errors'] = [];
  const registry = new BitrixRegistry();

  let droppedRows = 0;
  /** Показать строку человеку (с пределом, чтобы не раздувать строку пакета). */
  const pushRow = (row: PlanRow): void => {
    if (rows.length < ROW_CAP) rows.push(row);
    else droppedRows += 1;
  };
  /** Обычный путь: в списке показываем только пропуски и конфликты. */
  const addRow = (row: PlanRow): void => {
    if (row.action === 'create' || row.action === 'update') return;
    pushRow(row);
  };

  let done = 0;
  const progress = async (step: PipelineProgress['step']): Promise<void> => {
    if (!args.onProgress) return;
    await args.onProgress({ step, done, updatedAt: new Date().toISOString() });
  };
  const tick = async (step: PipelineProgress['step']): Promise<void> => {
    done += 1;
    counts.total += 1;
    if (done % PROGRESS_EVERY === 0) await progress(step);
  };

  // --- пользователи и стадии: из них человек соберёт таблицы сопоставления ---
  const [companyUsers, dealStages, funnelStages, taskColumns, closedStatus] = await Promise.all([
    loadCompanyUsers(prisma, batch.companyId),
    resolveDealStages(prisma, batch.companyId),
    resolveFunnelStages(prisma, batch.companyId),
    resolveTaskColumns(prisma, batch.companyId),
    findByAnchor(prisma, 'closed'),
  ]);

  const bitrixUsers = [];
  for await (const user of source.users()) bitrixUsers.push(user);
  const users = mapUsers(bitrixUsers, companyUsers, batch.tables.userMap ?? {});
  await progress('users');

  const stagesFound = await source.stages();
  const tables: BitrixMappingTables = {
    stageMap: proposeStageMap(stagesFound, dealStages.map(asTarget), batch.tables.stageMap ?? {}),
    leadStageMap: proposeLeadStageMap(
      stagesFound,
      funnelStages.map(asTarget),
      batch.tables.leadStageMap ?? {}
    ),
    taskColumnMap: proposeTaskColumnMap(
      taskColumns.map(asColumnTarget),
      batch.tables.taskColumnMap ?? {}
    ),
    userMap: Object.fromEntries(
      users.rows.filter((r) => r.userId).map((r) => [r.bitrixId, r.userId as string])
    ),
  };
  await progress('stages');

  const ctx: MappingContext = {
    companyId: batch.companyId,
    importerId: batch.importedById,
    defaultManagerId: batch.defaultManagerId,
    tables,
    resolveUser: users.resolve,
  };

  // --- организации ---
  for await (const page of pages(source.companies(batch.filter))) {
    const found = await loadOrganizations(prisma, batch.companyId, organizationKeysOf(page));
    for (const company of page) {
      const plan = planOrganization(company, ctx, {
        byBitrixId: (id) => found.byBitrixId.get(id),
        byInn: (inn) => found.byInn.get(inn),
        byNameKey: (key) => found.byNameKey.get(key),
      });
      countPlan(counts.organization, plan);
      addRow({
        entity: 'organization',
        bitrixId: company.id,
        title: company.title,
        action: plan.action,
        reason: planReason(plan),
      });
      rememberPlan(registry, 'organization', company.id, plan);
      await tick('organization');
    }
  }

  // --- контакты ---
  // Каналы, занятые контактами ЭТОГО пакета: база о них ещё не знает, а второй
  // контакт с тем же телефоном обязан уйти в конфликт, а не в «создать».
  const claimedChannels = new Map<string, ChannelOwnerRef>();
  for await (const page of pages(source.contacts(batch.filter))) {
    // Канал ищется в базе ТОЛЬКО в каноническом виде: «+7 (921) 111-22-33» и
    // «+79211112233» — один и тот же телефон, и сырое значение не нашло бы
    // существующий контакт, а применение упёрлось бы в уникальный индекс.
    const channels: ContactChannelData[] = [];
    for (const contact of page) {
      for (const phone of contact.phones) {
        channels.push({
          type: 'phone',
          value: phone,
          normalizedValue: normalizeChannelValue('phone', phone),
        });
      }
      for (const email of contact.emails) {
        channels.push({
          type: 'email',
          value: email,
          normalizedValue: normalizeChannelValue('email', email),
        });
      }
    }
    const found = await loadContacts(prisma, batch.companyId, {
      bitrixIds: page.map((c) => c.id),
      channels: channels.map((c) => ({ type: c.type, normalizedValue: c.normalizedValue })),
    });
    for (const contact of page) {
      const plan = planContact(contact, ctx, {
        byBitrixId: (id) => found.byBitrixId.get(id),
        channelOwner: (type, value) =>
          found.channelOwners.get(channelKey(type, value)) ??
          claimedChannels.get(channelKey(type, value)),
        contactById: (id) => found.byId.get(id),
        isUserChannel: (type, value) => found.userChannels.has(channelKey(type, value)),
        organizationByBitrixId: (id) => registry.get('organization', id),
      });
      claimChannels(claimedChannels, contact, plan);
      countPlan(counts.contact, plan);
      addRow({
        entity: 'contact',
        bitrixId: contact.id,
        title: [contact.name, contact.lastName].filter(Boolean).join(' ') || contact.id,
        action: plan.action,
        reason: planReason(plan),
      });
      rememberPlan(registry, 'contact', contact.id, plan);
      // Занятый канал не отменяет перенос контакта, но человек обязан о нём
      // узнать: телефон остался у другого, и это решение, а не мелочь.
      for (const conflict of channelConflicts(plan)) {
        pushRow({
          entity: 'contact',
          bitrixId: contact.id,
          title: [contact.name, contact.lastName].filter(Boolean).join(' ') || contact.id,
          action: 'conflict',
          reason: `канал не перенесён: ${conflict}`,
        });
      }
      // Организация контакта нужна заметкам о контакте и привязкам задач.
      const organizationId = contact.companyId
        ? registry.get('organization', contact.companyId)
        : undefined;
      if (organizationId) registry.set('contactOrg', contact.id, organizationId);
      registry.set(
        'contactName',
        contact.id,
        [contact.name, contact.lastName].filter(Boolean).join(' ') || contact.id
      );
      await tick('contact');
    }
  }

  // --- лиды ---
  for await (const page of pages(source.leads(batch.filter))) {
    const found = await loadLeads(
      prisma,
      page.map((l) => l.id)
    );
    const orgNames = await loadOrganizations(prisma, batch.companyId, {
      bitrixIds: [],
      inns: [],
      nameKeys: organizationKeysOf(
        page.map((l) => ({ id: l.id, inn: null, title: l.companyTitle ?? '' }))
      ).nameKeys,
    });
    for (const lead of page) {
      const plan = planLead(
        lead,
        ctx,
        {
          byBitrixId: (id) => found.get(id),
          organizationByName: (name) => {
            const key = organizationKeysOf([{ id: '', inn: null, title: name }]).nameKeys[0];
            return key ? orgNames.byNameKey.get(key)?.id : undefined;
          },
        },
        funnelStages.map(asTarget)
      );
      countPlan(counts.lead, plan);
      addRow({
        entity: 'lead',
        bitrixId: lead.id,
        title: lead.title || lead.id,
        action: plan.action,
        reason: planReason(plan),
      });
      rememberPlan(registry, 'lead', lead.id, plan);
      await tick('lead');
    }
  }

  // --- сделки и заказы из выигранных ---
  const wonDeals: { deal: Parameters<typeof planDeal>[0]; organizationId: string | null }[] = [];
  for await (const page of pages(source.deals(batch.filter))) {
    const found = await loadDeals(
      prisma,
      batch.companyId,
      page.map((d) => d.id)
    );
    for (const deal of page) {
      const plan = planDeal(
        deal,
        ctx,
        {
          byBitrixId: (id) => found.get(id),
          organizationByBitrixId: (id) => registry.get('organization', id),
          contactByBitrixId: (id) => registry.get('contact', id),
          leadByBitrixId: (id) => registry.get('lead', id),
        },
        dealStages.map(asTarget)
      );
      countPlan(counts.deal, plan);
      addRow({
        entity: 'deal',
        bitrixId: deal.id,
        title: deal.title || deal.id,
        action: plan.action,
        reason: planReason(plan),
      });
      rememberPlan(registry, 'deal', deal.id, plan);
      const organizationId = deal.companyId
        ? (registry.get('organization', deal.companyId) ?? null)
        : null;
      if (organizationId) registry.set('dealOrg', deal.id, organizationId);
      // «Сделка выиграна» — свойство стадии, а не плана записи: у обновления
      // патч частичный, и `wantsOrder` в нём может не быть вовсе. Иначе
      // выигранная сделка, уже заведённая в кабинете, не получала бы заказ.
      if (plan.action !== 'conflict') {
        const stage = dealStages.find((st) => st.id === tables.stageMap[dealStageKey(deal)]);
        if (stage?.statusAnchor === 'won') wonDeals.push({ deal, organizationId });
      }
      await tick('deal');
    }
  }

  const realOrgIds = [...new Set(wonDeals.map((w) => w.organizationId))].filter(
    (id): id is string => typeof id === 'string' && !isPlanned(id)
  );
  const ordersByOrg = await loadOrders(prisma, batch.companyId, realOrgIds);
  // Один заказ 1С не может закрыть две сделки: занятые убираются из кандидатов,
  // иначе сводка обещала бы привязку, а вторая сделка осталась бы ни с чем.
  const takenOrders = new Set<string>();
  for (const { deal, organizationId } of wonDeals) {
    const candidates = (organizationId ? (ordersByOrg.get(organizationId) ?? []) : []).filter(
      (o) => !takenOrders.has(o.id)
    );
    const plan = planOrderForWonDeal(deal, ctx, {
      organizationId,
      orders: candidates,
      closedStatusId: closedStatus?.id ?? null,
    });
    if (plan.action === 'link') {
      takenOrders.add(plan.orderId);
      counts.order.update += 1;
      // Эту строку показываем всегда: человек должен видеть, к какому заказу
      // привяжется сделка, а не только цифру в колонке «обновим».
      pushRow({
        entity: 'order',
        bitrixId: deal.id,
        title: deal.title || deal.id,
        action: 'update',
        reason: `заказ найден в 1С: ${plan.orderLabel}`,
      });
    } else {
      countPlan(counts.order, plan);
      addRow({
        entity: 'order',
        bitrixId: deal.id,
        title: deal.title || deal.id,
        action: plan.action,
        reason: planReason(plan),
      });
    }
    await tick('order');
  }

  // --- заметки из комментариев ---
  for (const entity of ['deal', 'company', 'contact'] as const) {
    const ids =
      entity === 'deal'
        ? registry.keys('deal')
        : entity === 'company'
          ? registry.keys('organization')
          : registry.keys('contact');
    if (ids.length === 0) continue;
    for await (const comment of source.comments(entity, ids)) {
      const plan =
        comment.entity === 'deal'
          ? planDealNote(comment, ctx, { dealByBitrixId: (id) => registry.get('deal', id) })
          : planOrganizationNote(comment, ctx, {
              organizationByBitrixId: (id) => registry.get('organization', id),
              contactOrganization: (id) => {
                const organizationId = registry.get('contactOrg', id) ?? null;
                return { organizationId, name: registry.get('contactName', id) ?? id };
              },
            });
      countPlan(counts.note, plan);
      addRow({
        entity: 'note',
        bitrixId: comment.id,
        title: comment.text.slice(0, 60),
        action: plan.action,
        reason: planReason(plan),
      });
      await tick('note');
    }
  }

  // --- задачи ---
  for await (const page of pages(source.tasks(batch.filter))) {
    const found = await loadTasks(
      prisma,
      batch.companyId,
      page.map((t) => t.id)
    );
    for (const task of page) {
      const plan = planTask(
        task,
        ctx,
        {
          byBitrixId: (id) => found.get(id),
          organizationByBitrixId: (id) => registry.get('organization', id),
          dealByBitrixId: (id) => registry.get('deal', id),
          leadByBitrixId: (id) => registry.get('lead', id),
          contactOrganization: (id) => registry.get('contactOrg', id),
        },
        taskColumns.map(asColumnTarget)
      );
      countPlan(counts.task, plan);
      addRow({
        entity: 'task',
        bitrixId: task.id,
        title: task.title || task.id,
        action: plan.action,
        reason: planReason(plan),
      });
      rememberPlan(registry, 'task', task.id, plan);
      await tick('task');
    }
  }

  // --- файлы ---
  if (batch.withFiles) {
    for (const entity of ['deal', 'company'] as const) {
      const ids = entity === 'deal' ? registry.keys('deal') : registry.keys('organization');
      if (ids.length === 0) continue;
      const seen: string[] = [];
      for await (const file of source.files(entity, ids)) seen.push(file.id);
      const known = await loadDocuments(prisma, batch.companyId, seen);
      for await (const file of source.files(entity, ids)) {
        const plan = planFile(file, ctx, {
          byBitrixId: (id) => (known.has(id) ? { id } : undefined),
          organizationByBitrixId: (id) => registry.get('organization', id),
          dealOrganization: (id) => registry.get('dealOrg', id),
        });
        countPlan(counts.file, plan);
        addRow({
          entity: 'file',
          bitrixId: file.id,
          title: file.name,
          action: plan.action,
          reason: planReason(plan),
        });
        await tick('file');
      }
    }
  } else {
    counts.file.skip += 1;
    addRow({
      entity: 'file',
      bitrixId: '—',
      title: 'Файлы',
      action: 'skip',
      reason: 'файлы не запрошены в настройках пакета',
    });
    await tick('file');
  }

  if (droppedRows > 0) {
    counts.warnings.push(
      `Показаны первые ${ROW_CAP} строк из ${ROW_CAP + droppedRows}: остальные того же рода. Полный перечень будет в отчёте сверки.`
    );
  }
  if (counts.total > BIG_BATCH) {
    counts.warnings.push(
      `В пакете ${counts.total} записей — это много для одного прогона. Разбейте перенос по кварталам: так и ошибку легче найти, и откат будет короче.`
    );
  }

  await progress('file');
  counts.progress = { step: 'file', done, updatedAt: new Date().toISOString() };

  return {
    counts,
    stagesFound,
    usersFound: users.rows,
    tables,
    rows,
    errors,
    ready: stageMapComplete(stagesFound, tables.stageMap, tables.leadStageMap),
  };
}

/** Запомнить каналы контакта за ним: в пределах пакета телефон тоже занят. */
function claimChannels(
  claimed: Map<string, ChannelOwnerRef>,
  contact: { id: string; name: string; lastName: string },
  plan: Plan<ContactData>
): void {
  const channels =
    plan.action === 'create'
      ? plan.data.channels
      : plan.action === 'update'
        ? (plan.data.channels ?? [])
        : [];
  if (channels.length === 0) return;
  const owner: ChannelOwnerRef = {
    contactId: plan.action === 'update' ? plan.id : plannedId('contact', contact.id),
    contactName: [contact.name, contact.lastName].filter(Boolean).join(' ') || contact.id,
    bitrixId: contact.id,
  };
  for (const channel of channels) {
    const key = channelKey(channel.type, channel.normalizedValue);
    if (!claimed.has(key)) claimed.set(key, owner);
  }
}

/** Запомнить, что сущность существует (или появится) — по этому строятся связи. */
function rememberPlan(
  registry: BitrixRegistry,
  entity: string,
  bitrixId: string,
  plan: Plan<unknown>
): void {
  if (plan.action === 'update') registry.set(entity, bitrixId, plan.id);
  else if (plan.action === 'create') registry.plan(entity, bitrixId);
  // «Нечего менять» — это тоже «запись есть». Без этой ветки повторный прогон
  // забывал уже перенесённую организацию, и её сделки, комментарии и файлы
  // исчезали из сводки: на одних и тех же данных предпросмотр показывал разное.
  else if (plan.action === 'skip' && plan.id) registry.set(entity, bitrixId, plan.id);
}
