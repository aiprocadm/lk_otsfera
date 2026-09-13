import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getQueue } from '@/lib/jobs/queues';
import { bestEffort, log } from '@/lib/logging';
import type { FieldMap } from './idempotency';
import type { BitrixEntity } from './mapping/types';

/**
 * Откат пакета миграции (`У-196`, спека §3.6).
 *
 * Перенос трогает рабочую базу, поэтому у него обязана быть кнопка «вернуть
 * как было». Возвращает не «снимок базы» — такого снимка никто не делает, — а
 * ровно те строки, которые записал этот пакет: журнал `BitrixImportWrite`
 * помнит каждую.
 *
 * Окно — 30 дней с применения, как у отката импорта 1С. Дальше откатывать
 * опасно: на перенесённые строки успевают лечь оплаты, документы и переписка,
 * и «вернуть как было» означало бы стереть работу людей.
 */
// Наружу не экспортируется: тексты интерфейса несут «30 дней» словами, а не
// подстановкой (так же, как у отката импорта 1С).
const ROLLBACK_WINDOW_DAYS = 30;
const WINDOW_MS = ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type RollbackState =
  /** Можно откатывать прямо сейчас. */
  | 'available'
  /** Пакет не применяли — откатывать нечего. */
  | 'not_applied'
  /** Пакет прямо сейчас в работе: идёт применение или уже идёт откат. */
  | 'in_progress'
  /** Уже откачен целиком. */
  | 'rolled_back'
  /** Прошло больше 30 дней. */
  | 'expired'
  /** Журнал пуст: применение ничего не записало. */
  | 'nothing_to_revert';

export const ROLLBACK_STATE_HINTS: Record<RollbackState, string> = {
  available: '',
  not_applied: 'Пакет ещё не применён — возвращать нечего.',
  in_progress: 'Пакет сейчас в работе — дождитесь окончания, экран обновится сам.',
  rolled_back: 'Этот пакет уже откачен.',
  expired: `Откат возможен ${ROLLBACK_WINDOW_DAYS} дней после применения — срок вышел.`,
  nothing_to_revert: 'Применение не записало ни одной строки.',
};

/**
 * Состояние кнопки «Откатить». Считается по статусу пакета, дате применения и
 * числу неоткаченных строк журнала — тех же данных, по которым потом пойдёт
 * сам откат. Разъехаться подпись и поведение не могут.
 */
export function rollbackStateOf(
  batch: { status: string; appliedAt: Date | null },
  now: number,
  pendingRows: number
): RollbackState {
  if (batch.status === 'rolled_back') return 'rolled_back';
  // «Откатываем» и «применяем» — это НЕ «не применён». Подпись «возвращать
  // нечего» рядом со строкой «Откатываем» противоречила бы сама себе (§15).
  if (batch.status === 'rolling_back' || batch.status === 'applying') return 'in_progress';
  if (batch.status !== 'applied' && batch.status !== 'rollback_partial') return 'not_applied';
  if (!batch.appliedAt) return 'not_applied';
  if (now - batch.appliedAt.getTime() > WINDOW_MS) return 'expired';
  if (pendingRows === 0) return 'nothing_to_revert';
  return 'available';
}

export type RollbackRequestError = 'forbidden' | 'not_found' | 'queue' | RollbackState;

export type RollbackRequestResult = { ok: true } | { ok: false; error: RollbackRequestError };

/**
 * «Откатить»: проверяет, что откат уместен, и отдаёт работу воркеру. Сам откат
 * идёт порциями — пакет может быть большим, и одной транзакцией его не взять.
 */
export async function requestRollback(
  prisma: PrismaClient,
  session: SessionPayload,
  batchId: string
): Promise<RollbackRequestResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const batch = await prisma.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, companyId: true, status: true, appliedAt: true },
  });
  if (!batch || batch.companyId !== session.companyId) return { ok: false, error: 'not_found' };

  const pendingRows = await prisma.bitrixImportWrite.count({
    where: { batchId, reverted: false },
  });
  const state = rollbackStateOf(batch, Date.now(), pendingRows);
  if (state !== 'available') return { ok: false, error: state };

  // Очередь СНАЧАЛА, статус — потом. Наоборот пакет залипал бы в «откатываем»
  // навсегда: задача не поставлена, а кнопка уже мертва. Это единственное
  // место программы, где сбой очереди не проглатывается (§3): без задачи
  // откат просто не произойдёт, и молчать об этом нельзя.
  try {
    await getQueue('bitrix.import').add('rollback', { batchId });
  } catch (e) {
    log.error('[bitrix/rollback] задача отката не поставлена', {
      batchId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'queue' };
  }
  await prisma.bitrixImportBatch.update({
    where: { id: batchId },
    data: { status: 'rolling_back' },
  });

  return { ok: true };
}

// ─────────────────────────── сам откат ───────────────────────────

/**
 * Порядок отката — обратный порядку записи: сначала дети, потом родители.
 * Иначе удаление организации упрётся в её же перенесённый заказ и вся порция
 * свалится по внешнему ключу.
 */
const ROLLBACK_ORDER: BitrixEntity[] = [
  'file',
  'note',
  'task',
  'order',
  'deal',
  'lead',
  'contact',
  'organization',
];

/** Порция одной транзакции. Больше — дольше держим блокировки на живой базе. */
const CHUNK = 100;

/** Больше строк в отчёт о конфликтах не кладём: остальные того же рода. */
const CONFLICT_CAP = 500;

export type RollbackConflict = {
  entity: BitrixEntity;
  entityId: string;
  /** Что показать человеку: название организации, тема лида, номер заказа. */
  label: string;
  /** Стабильный код причины — русский текст даёт словарь ниже. */
  code: RollbackConflictCode;
  count: number;
};

export type RollbackConflictCode =
  | 'order_has_payments'
  | 'order_has_lines'
  | 'order_has_documents'
  | 'organization_has_orders'
  | 'organization_has_documents'
  | 'organization_has_contacts'
  | 'contact_has_dialogs'
  | 'contact_has_calls'
  | 'deal_has_notes'
  | 'order_has_other_links'
  | 'organization_has_other_links'
  | 'contact_has_other_links'
  | 'lead_has_documents'
  | 'lead_has_other_links'
  | 'deal_has_other_links'
  | 'record_missing';

export const ROLLBACK_CONFLICT_LABELS: Record<RollbackConflictCode, string> = {
  order_has_payments: 'у заказа появились оплаты',
  order_has_lines: 'у заказа появились строки',
  order_has_documents: 'у заказа появились документы',
  organization_has_orders: 'у организации появились заказы',
  organization_has_documents: 'у организации появились документы',
  organization_has_contacts: 'у организации появились контакты',
  contact_has_dialogs: 'у контакта появилась переписка',
  contact_has_calls: 'у контакта появились звонки',
  deal_has_notes: 'у сделки появились заметки',
  order_has_other_links: 'на заказе появились другие записи',
  organization_has_other_links: 'у организации появились другие записи',
  contact_has_other_links: 'на контакт ссылаются другие записи',
  lead_has_documents: 'по лиду выставлены документы',
  lead_has_other_links: 'у лида появились вложения или задачи',
  deal_has_other_links: 'на сделку ссылаются другие записи',
  record_missing: 'запись удалили вручную',
};

/**
 * Белый список полей восстановления. Журнал — обычная таблица, и слепо писать
 * в базу всё, что в нём лежит, нельзя: испорченный снимок увёл бы строку в
 * чужую компанию. Поэтому возвращаем только те колонки, которые миграция
 * вообще умеет менять.
 */
const RESTORE_FIELDS: Partial<Record<BitrixEntity, readonly string[]>> = {
  organization: ['name', 'nameKey', 'inn', 'kpp', 'bitrixId'],
  contact: ['name', 'position', 'organizationId', 'bitrixId'],
  lead: [
    'source',
    'status',
    'funnelStageId',
    'subject',
    'clientCompanyName',
    'clientContactName',
    'clientContactPhone',
    'clientContactEmail',
    'clientInn',
    'estimatedAmount',
    'organizationId',
    'assignedManagerId',
    'notes',
    'bitrixId',
  ],
  deal: [
    'title',
    'amount',
    'status',
    'stageId',
    'organizationId',
    'contactId',
    'leadId',
    'managerId',
    'expectedCloseAt',
    'wonAt',
    'lostAt',
    'bitrixId',
  ],
  task: [
    'title',
    'description',
    'status',
    'columnId',
    'dueDate',
    'completedAt',
    'linkedOrganizationId',
    'linkedDealId',
    'linkedLeadId',
    'bitrixId',
  ],
};

/** Колонки-даты: в журнале они лежат строками ISO, база ждёт `Date`. */
const DATE_FIELDS = new Set(['expectedCloseAt', 'wonAt', 'lostAt', 'dueDate', 'completedAt']);

/**
 * Снимок «до» → аргумент `update`. Поля не из белого списка отбрасываются
 * молча: это не ошибка данных, а защита от лишней колонки в старом снимке.
 */
export function restoreData(entity: BitrixEntity, before: FieldMap): Record<string, unknown> {
  const allowed = RESTORE_FIELDS[entity] ?? [];
  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!Object.hasOwn(before, field)) continue;
    const value = before[field];
    out[field] = DATE_FIELDS.has(field) && typeof value === 'string' ? new Date(value) : value;
  }
  return out;
}

type JournalRow = {
  id: string;
  entity: BitrixEntity;
  entityId: string;
  bitrixId: string;
  action: string;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
};

const asMap = (value: Prisma.JsonValue): FieldMap =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as FieldMap) : {};

export type RollbackProgress = {
  entity: BitrixEntity;
  done: number;
  updatedAt: string;
};

export type RollbackSummary = {
  status: 'rolled_back' | 'rollback_partial';
  /** Сколько строк журнала вернули на место. */
  reverted: number;
  deleted: number;
  restored: number;
  unlinked: number;
  conflicts: RollbackConflict[];
  errors: { bitrixId: string; entity: string; message: string }[];
};

/**
 * Откат пакета (`У-196`). Идёт порциями: каждая порция — отдельная короткая
 * транзакция, поэтому пакет на десятки тысяч строк не держит базу целиком и
 * не теряет всю работу из-за одной упавшей строки.
 *
 * Строка, которую вернуть нельзя (на перенесённый заказ легли оплаты),
 * не откатывается и попадает в список конфликтов — итог тогда
 * `rollback_partial`. Молчаливое «как-нибудь удалим» здесь недопустимо: это
 * потеря чужой работы.
 */
export async function runRollback(
  prisma: PrismaClient,
  batchId: string,
  onProgress?: (progress: RollbackProgress) => Promise<void>
): Promise<RollbackSummary> {
  const conflicts: RollbackConflict[] = [];
  const errors: RollbackSummary['errors'] = [];
  let deleted = 0;
  let restored = 0;
  let unlinked = 0;
  let reverted = 0;
  let stuck = 0;

  for (const entity of ROLLBACK_ORDER) {
    let done = 0;
    for (;;) {
      // Читаем в обратном порядке записи: внутри сущности связи тоже бывают
      // (сделка ссылается на лид, заведённый этим же пакетом раньше).
      const rows = (await prisma.bitrixImportWrite.findMany({
        where: { batchId, entity, reverted: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CHUNK,
        skip: stuck,
        select: {
          id: true,
          entity: true,
          entityId: true,
          bitrixId: true,
          action: true,
          before: true,
          after: true,
        },
      })) as JournalRow[];
      if (rows.length === 0) break;

      let outcome: ChunkOutcome;
      try {
        outcome = await prisma.$transaction((tx) => revertChunk(tx, entity, rows));
      } catch {
        // Порция — одна транзакция, поэтому одна непредвиденная строка
        // отменила бы возврат сотни соседних, ни в чём не виноватых. Повторяем
        // по одной: своя транзакция на строку, ошибка остаётся при своей
        // строке. Медленнее — но откат обязан довести до конца всё, что может.
        outcome = await revertOneByOne(prisma, entity, rows, errors);
      }

      deleted += outcome.deleted;
      restored += outcome.restored;
      unlinked += outcome.unlinked;
      reverted += outcome.reverted;
      done += outcome.reverted;
      for (const conflict of outcome.conflicts) {
        if (conflicts.length < CONFLICT_CAP) conflicts.push(conflict);
      }
      // Строки-конфликты остаются неоткаченными: следующий запрос увидит их
      // снова. Сдвигаем окно чтения, иначе цикл встал бы на них навсегда.
      stuck += rows.length - outcome.reverted;

      if (onProgress) {
        await onProgress({ entity, done, updatedAt: new Date().toISOString() }).catch(
          bestEffort('[bitrix/rollback] прогресс не записан')
        );
      }
      if (rows.length < CHUNK) break;
    }
    stuck = 0;
  }

  const status: RollbackSummary['status'] =
    conflicts.length === 0 && errors.length === 0 ? 'rolled_back' : 'rollback_partial';
  return { status, reverted, deleted, restored, unlinked, conflicts, errors };
}

type ChunkOutcome = {
  reverted: number;
  deleted: number;
  restored: number;
  unlinked: number;
  conflicts: RollbackConflict[];
};

/**
 * Одна порция: считаем конфликты, возвращаем что можно, помечаем строки
 * откаченными. Всё в одной транзакции — иначе строка могла бы исчезнуть из
 * базы, оставшись неоткаченной в журнале, и второй запуск отката удалил бы
 * чужую запись с тем же id.
 */
async function revertChunk(
  tx: Prisma.TransactionClient,
  entity: BitrixEntity,
  rows: JournalRow[]
): Promise<ChunkOutcome> {
  const created = rows.filter((r) => r.action === 'created');
  const updated = rows.filter((r) => r.action === 'updated');
  const linked = rows.filter((r) => r.action === 'linked');

  const { conflicts, blocked } = await computeRollbackConflicts(tx, entity, created);

  // Цель обновления могли удалить руками — тогда возвращать нечего, и это
  // конфликт, а не ошибка: человек уже принял решение об этой записи.
  const alive = await existingIds(
    tx,
    entity,
    updated.map((r) => r.entityId)
  );
  for (const row of updated) {
    if (!alive.has(row.entityId)) {
      conflicts.push({
        entity,
        entityId: row.entityId,
        label: row.entityId,
        code: 'record_missing',
        count: 1,
      });
      blocked.add(row.entityId);
    }
  }

  const safeCreated = created.filter((r) => !blocked.has(r.entityId));
  const safeUpdated = updated.filter((r) => !blocked.has(r.entityId));

  const deleted = await deleteCreated(
    tx,
    entity,
    safeCreated.map((r) => r.entityId)
  );

  let restored = 0;
  for (const row of safeUpdated) {
    const data = restoreData(entity, asMap(row.before)) as never;
    if (Object.keys(data).length === 0) continue;
    await updateOne(tx, entity, row.entityId, data);
    restored += 1;
  }

  let unlinked = 0;
  for (const row of linked) {
    const before = asMap(row.before);
    const dealId = typeof before.dealId === 'string' ? before.dealId : null;
    if (!dealId) continue;
    // Снимаем связь только если она всё ещё наша: менеджер мог перепривязать
    // сделку к другому заказу, и обнулять его выбор откат не вправе.
    const res = await tx.deal.updateMany({
      where: { id: dealId, orderId: row.entityId },
      data: { orderId: null },
    });
    unlinked += res.count;
  }

  const revertedRows = [...safeCreated, ...safeUpdated, ...linked];
  if (revertedRows.length > 0) {
    await tx.bitrixImportWrite.updateMany({
      where: { id: { in: revertedRows.map((r) => r.id) } },
      data: { reverted: true },
    });
  }

  return { reverted: revertedRows.length, deleted, restored, unlinked, conflicts };
}

/** Таблица сущности. `note` и `file` живут отдельно — у них своя обработка. */
const DELEGATE: Partial<
  Record<BitrixEntity, 'organization' | 'contact' | 'lead' | 'deal' | 'task' | 'order'>
> = {
  organization: 'organization',
  contact: 'contact',
  lead: 'lead',
  deal: 'deal',
  task: 'task',
  order: 'order',
};

type Finder = { findMany: (a: unknown) => Promise<Array<{ id: string }>> };
type Deleter = { deleteMany: (a: unknown) => Promise<{ count: number }> };
type Updater = { update: (a: unknown) => Promise<unknown> };

async function existingIds(
  tx: Prisma.TransactionClient,
  entity: BitrixEntity,
  ids: string[]
): Promise<Set<string>> {
  const delegate = DELEGATE[entity];
  if (!delegate || ids.length === 0) return new Set(ids);
  const found = await (tx[delegate] as unknown as Finder).findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(found.map((r) => r.id));
}

async function deleteCreated(
  tx: Prisma.TransactionClient,
  entity: BitrixEntity,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  if (entity === 'file') {
    // Сам файл в хранилище остаётся: удалить его — значит потерять вложение
    // навсегда, а откат обязан быть обратимым. Строка документа исчезает,
    // объект становится сиротой и убирается штатной уборкой хранилища.
    return (await tx.document.deleteMany({ where: { id: { in: ids } } })).count;
  }
  if (entity === 'note') {
    // Заметка сделки и заметка организации лежат в разных таблицах, а в
    // журнале обе записаны как `note`. Идентификаторы уникальны, поэтому
    // просто чистим обе: лишний запрос дешевле хрупкого разбора снимка.
    const deal = await tx.dealNote.deleteMany({ where: { id: { in: ids } } });
    const org = await tx.organizationNote.deleteMany({ where: { id: { in: ids } } });
    return deal.count + org.count;
  }
  if (entity === 'deal') {
    // Лид, из которого выросла сделка, хранит ссылку на неё без внешнего
    // ключа — база её не почистит. Снимаем сами, иначе после отката лид
    // остался бы «сконвертированным» в сделку, которой больше нет.
    await tx.lead.updateMany({
      where: { promotedDealId: { in: ids } },
      data: { promotedDealId: null },
    });
  }
  const delegate = DELEGATE[entity];
  /* v8 ignore next -- недостижимо: сюда доходят только сущности ROLLBACK_ORDER без `file` и `note` (те вышли выше), а это ровно ключи DELEGATE; проверка стоит ради типа Partial<Record<…>> */
  if (!delegate) return 0;
  return (await (tx[delegate] as unknown as Deleter).deleteMany({ where: { id: { in: ids } } }))
    .count;
}

async function updateOne(
  tx: Prisma.TransactionClient,
  entity: BitrixEntity,
  id: string,
  data: never
): Promise<void> {
  const delegate = DELEGATE[entity];
  /* v8 ignore next -- недостижимо: сюда приходят только сущности, у которых `restoreData` вернула непустой объект, то есть заведённые в RESTORE_FIELDS; все пять есть в DELEGATE */
  if (!delegate) return;
  await (tx[delegate] as unknown as Updater).update({ where: { id }, data });
}

/**
 * Что мешает удалить перенесённые строки (`У-196`).
 *
 * Правило одно: удалять можно, пока на записи не легло НИЧЕГО, чего не
 * приносил этот же пакет. Оплата, строка заказа, новый контакт, переписка —
 * всё это работа людей, сделанная после переноса, и откат не вправе её стереть.
 * Такая строка не откатывается, а попадает в список конфликтов.
 *
 * Считаются ЖИВЫЕ дети на момент проверки, а не «наши по журналу». Порядок
 * отката идёт от детей к родителям, поэтому всё, что пакет завёл и сумел
 * убрать, к этому моменту уже удалено — а всё, что осталось, останется и
 * после отката и честно мешает удалить родителя. Проверка «ребёнок наш по
 * журналу» здесь была бы ложью: заказ, который сам не откатился из-за оплаты,
 * числился бы «нашим», организация бы не заблокировалась, и удаление упало бы
 * по внешнему ключу сырым текстом исключения вместо понятной причины.
 */
export async function computeRollbackConflicts(
  tx: Prisma.TransactionClient,
  entity: BitrixEntity,
  created: JournalRow[]
): Promise<{ conflicts: RollbackConflict[]; blocked: Set<string> }> {
  const conflicts: RollbackConflict[] = [];
  const blocked = new Set<string>();
  const ids = created.map((r) => r.entityId);
  if (ids.length === 0) return { conflicts, blocked };

  const add = (entityId: string, label: string, code: RollbackConflictCode, count: number) => {
    if (count <= 0) return;
    conflicts.push({ entity, entityId, label, code, count });
    blocked.add(entityId);
  };

  if (entity === 'order') {
    const orders = await tx.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, title: true, _count: { select: ORDER_LINKS } },
    });
    for (const o of orders) {
      const label = o.orderNumber ?? o.title;
      const c = o._count;
      add(o.id, label, 'order_has_payments', c.payments);
      add(o.id, label, 'order_has_lines', c.items + c.lines);
      add(o.id, label, 'order_has_documents', c.documents);
      add(
        o.id,
        label,
        'order_has_other_links',
        c.comments + c.uploads + c.threads + c.commissionItems + c.dealNotes
      );
    }
    return { conflicts, blocked };
  }

  if (entity === 'organization') {
    const orgs = await tx.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, _count: { select: ORG_LINKS } },
    });
    const docs = await tx.document.groupBy({
      by: ['counterpartyId'],
      where: { counterpartyType: 'organization', counterpartyId: { in: ids } },
      _count: { _all: true },
    });
    const docsByOrg = new Map(docs.map((d) => [d.counterpartyId, d._count._all]));
    for (const org of orgs) {
      const c = org._count;
      add(org.id, org.name, 'organization_has_orders', c.orders);
      add(org.id, org.name, 'organization_has_contacts', c.contacts);
      add(org.id, org.name, 'organization_has_documents', docsByOrg.get(org.id) ?? 0);
      // Всё остальное, чем база держит организацию: люди, заявки, деньги,
      // переписка. Пакет ничего из этого не заводит, поэтому любая такая
      // строка появилась после переноса.
      add(
        org.id,
        org.name,
        'organization_has_other_links',
        c.users +
          c.organizationUsers +
          c.students +
          c.certificates +
          c.deals +
          c.leads +
          c.clientRequests +
          c.enrollmentRequests +
          c.payments +
          c.notifications +
          c.commissionRateChanges +
          c.tasks +
          c.calendarEvents +
          c.inboundMessages +
          c.messengerDialogs +
          c.calls +
          c.notes
      );
    }
    return { conflicts, blocked };
  }

  if (entity === 'contact') {
    const contacts = await tx.contact.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, _count: { select: CONTACT_LINKS } },
    });
    for (const c of contacts) {
      add(
        c.id,
        c.name,
        'contact_has_dialogs',
        c._count.inboundMessages + c._count.messengerDialogs
      );
      add(c.id, c.name, 'contact_has_calls', c._count.calls);
      add(c.id, c.name, 'contact_has_other_links', c._count.ordersAsPrimary + c._count.mergedFrom);
    }
    return { conflicts, blocked };
  }

  if (entity === 'lead') {
    const leads = await tx.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, subject: true, _count: { select: LEAD_LINKS } },
    });
    for (const l of leads) {
      // `Document.leadId` и `LeadAttachment.leadId` — жёсткие ключи: пока живо
      // коммерческое предложение или вложение, лид не удалить.
      add(l.id, l.subject, 'lead_has_documents', l._count.proposals);
      add(l.id, l.subject, 'lead_has_other_links', l._count.attachments + l._count.tasks);
    }
    return { conflicts, blocked };
  }

  if (entity === 'deal') {
    const deals = await tx.deal.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, _count: { select: DEAL_LINKS } },
    });
    for (const d of deals) {
      add(d.id, d.title, 'deal_has_notes', d._count.notes);
      add(d.id, d.title, 'deal_has_other_links', d._count.proposals + d._count.tasks);
    }
  }

  return { conflicts, blocked };
}

/** Связи, которыми база держит заказ. Строки `select` для `_count`. */
const ORDER_LINKS = {
  payments: true,
  items: true,
  lines: true,
  documents: true,
  comments: true,
  uploads: true,
  threads: true,
  commissionItems: true,
  dealNotes: true,
} as const;

const ORG_LINKS = {
  orders: true,
  contacts: true,
  users: true,
  organizationUsers: true,
  students: true,
  certificates: true,
  deals: true,
  leads: true,
  clientRequests: true,
  enrollmentRequests: true,
  payments: true,
  notifications: true,
  commissionRateChanges: true,
  tasks: true,
  calendarEvents: true,
  inboundMessages: true,
  messengerDialogs: true,
  calls: true,
  notes: true,
} as const;

const CONTACT_LINKS = {
  inboundMessages: true,
  messengerDialogs: true,
  calls: true,
  ordersAsPrimary: true,
  mergedFrom: true,
} as const;

const LEAD_LINKS = { proposals: true, attachments: true, tasks: true } as const;

const DEAL_LINKS = { notes: true, proposals: true, tasks: true } as const;

/**
 * Повтор упавшей порции по одной строке. Возвращает суммарный итог; строки,
 * которые не прошли и поодиночке, остаются неоткаченными и уезжают в `errors`
 * — человек увидит их в отчёте сверки вместе с причиной.
 */
async function revertOneByOne(
  prisma: PrismaClient,
  entity: BitrixEntity,
  rows: JournalRow[],
  errors: RollbackSummary['errors']
): Promise<ChunkOutcome> {
  const total: ChunkOutcome = {
    reverted: 0,
    deleted: 0,
    restored: 0,
    unlinked: 0,
    conflicts: [],
  };
  for (const row of rows) {
    try {
      const one = await prisma.$transaction((tx) => revertChunk(tx, entity, [row]));
      total.reverted += one.reverted;
      total.deleted += one.deleted;
      total.restored += one.restored;
      total.unlinked += one.unlinked;
      total.conflicts.push(...one.conflicts);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (errors.length < CONFLICT_CAP) errors.push({ bitrixId: row.bitrixId, entity, message });
    }
  }
  return total;
}
