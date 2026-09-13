import type { BitrixStage, BitrixUser } from '../source';

/**
 * План записи одной сущности (`У-191`, спека §3.3). Сопоставление — чистые
 * функции: на вход нормализованная запись Битрикса и состояние ЛК, на выход —
 * что сделать. Ничего не пишется: предпросмотр (`shadow`) считает по этим же
 * планам сводку, а применение (`live`, PR-4) исполняет их писателями.
 *
 * `skip` — «так и задумано» (нечего переносить, источник не даёт), `conflict` —
 * «перенести нельзя, человек должен решить»: в предпросмотре они показаны
 * разными колонками, и `conflict` не даёт применить пакет молча.
 */
export type PlanCreate<T> = { action: 'create'; data: T };

/**
 * Снимок «как было». `null` допустим у любого поля: «раньше значения не было»
 * — такой же факт, как старое значение, и откат обязан его восстановить.
 */
export type PlanBefore<T> = { [K in keyof T]?: T[K] | null };

export type PlanUpdate<T> = {
  action: 'update';
  id: string;
  data: Partial<T>;
  /** Снимок изменяемых полей ДО записи — из него откат восстанавливает строку. */
  before: PlanBefore<T>;
};
export type PlanSkip = { action: 'skip'; reason: SkipReason };
export type PlanConflict = { action: 'conflict'; reason: ConflictReason; hint?: string };

export type Plan<T> = PlanCreate<T> | PlanUpdate<T> | PlanSkip | PlanConflict;

/** Причины пропуска — стабильные коды (§3 CLAUDE.md); русские подписи живут в UI. */
export type SkipReason =
  | 'no_organization'
  | 'no_contact'
  | 'empty'
  | 'too_large'
  | 'source_no_files'
  | 'unsupported'
  | 'already_linked'
  | 'no_changes';

export type ConflictReason =
  'inn_other_company' | 'channel_taken' | 'stage_not_mapped' | 'no_manager' | 'no_deal_stage';

/** Русские подписи причин — один словарь на предпросмотр, отчёт и историю. */
export const SKIP_LABELS: Record<SkipReason, string> = {
  no_organization: 'нет организации',
  no_contact: 'нет контакта',
  empty: 'пустая запись',
  too_large: 'файл больше допустимого размера',
  source_no_files: 'источник не даёт файлов',
  unsupported: 'не поддерживается',
  already_linked: 'уже связано',
  no_changes: 'нечего менять',
};

export const CONFLICT_LABELS: Record<ConflictReason, string> = {
  inn_other_company: 'ИНН у организации другой компании',
  channel_taken: 'канал уже у другого контакта',
  stage_not_mapped: 'стадия не сопоставлена',
  no_manager: 'некому назначить ответственного',
  no_deal_stage: 'у компании нет подходящей стадии сделки',
};

/** Сущности пакета в порядке зависимостей — он же порядок записи в `live`. */
export const BITRIX_ENTITIES = [
  'organization',
  'contact',
  'lead',
  'deal',
  'note',
  'task',
  'file',
  'order',
] as const;

export type BitrixEntity = (typeof BITRIX_ENTITIES)[number];

export const BITRIX_ENTITY_TITLES: Record<BitrixEntity, string> = {
  organization: 'Организации',
  contact: 'Контакты',
  lead: 'Лиды',
  deal: 'Сделки',
  note: 'Заметки',
  task: 'Задачи',
  file: 'Файлы',
  order: 'Заказы из выигранных сделок',
};

/**
 * Таблицы сопоставления, которые администратор правит в предпросмотре и
 * которые лежат в `settings` пакета. Ключи — идентификаторы портала, значения —
 * идентификаторы ЛК; `null` — «не сопоставлено» (пакет применить нельзя).
 */
export type BitrixMappingTables = {
  /** `<направление>:<стадия>` → id стадии сделки ЛК или синтетический `default:*`. */
  stageMap: Record<string, string | null>;
  /** Статус лида портала → id стадии воронки ЛК или `default:*`. */
  leadStageMap: Record<string, string | null>;
  /** Статус задачи Битрикса (2..6) → id колонки задач ЛК. */
  taskColumnMap: Record<string, string | null>;
  /** Пользователь портала → id пользователя ЛК; пусто — менеджер по умолчанию. */
  userMap: Record<string, string>;
};

/** Что известно о ЛК для одной порции записей — читается пачкой перед планированием. */
export type MappingContext = {
  companyId: string;
  /** Кто запустил пакет: автор создаваемых строк там, где автор обязателен. */
  importerId: string;
  /** Менеджер по умолчанию для несопоставленных ответственных (`У-192`). */
  defaultManagerId: string | null;
  tables: BitrixMappingTables;
  /** Пользователь портала → пользователь ЛК (готовый результат `mapUsers`). */
  resolveUser: (bitrixUserId: string | null) => string | null;
};

/** Сводка по сущности для экрана предпросмотра и отчёта. */
export type EntityCounts = {
  create: number;
  update: number;
  skip: number;
  conflict: number;
};

export const emptyCounts = (): EntityCounts => ({ create: 0, update: 0, skip: 0, conflict: 0 });

/** Одна строка «что случилось» — и для предпросмотра, и для отчёта (§3.6). */
export type PlanRow = {
  entity: BitrixEntity;
  bitrixId: string;
  title: string;
  action: Plan<unknown>['action'];
  reason?: string;
};

export function countPlan(counts: EntityCounts, plan: Plan<unknown>): void {
  if (plan.action === 'create') counts.create += 1;
  else if (plan.action === 'update') counts.update += 1;
  else if (plan.action === 'skip') counts.skip += 1;
  else counts.conflict += 1;
}

/** Человеческая причина плана — пустая строка для `create`/`update`. */
export function planReason(plan: Plan<unknown>): string {
  if (plan.action === 'skip') return SKIP_LABELS[plan.reason];
  if (plan.action === 'conflict') {
    return plan.hint
      ? `${CONFLICT_LABELS[plan.reason]}: ${plan.hint}`
      : CONFLICT_LABELS[plan.reason];
  }
  return '';
}

/**
 * Ключ стадии сделки в таблице сопоставления. Направление «0» — общее; в
 * Битриксе у него стадии без префикса, у остальных — `C<id>:STAGE`, поэтому
 * ключ строится из пары, а не из одного идентификатора стадии.
 */
export function stageKey(stage: Pick<BitrixStage, 'categoryId' | 'id'>): string {
  // Пустая строка считается общим направлением так же, как `null`: иначе ключ
  // стадии и ключ сделки разошлись бы, и стадия выглядела бы несопоставленной.
  return `${stage.categoryId || '0'}:${stage.id}`;
}

export function dealStageKey(deal: { categoryId: string; stageId: string }): string {
  return `${deal.categoryId || '0'}:${deal.stageId}`;
}

/** Пользователь портала в виде строки таблицы предпросмотра. */
export type UserMapRow = {
  bitrixId: string;
  name: string;
  email: string | null;
  /** Найденный пользователь ЛК или `null` — тогда действует менеджер по умолчанию. */
  userId: string | null;
  /** Как нашли: по почте, по сохранённой таблице или никак. */
  matchedBy: 'email' | 'table' | 'none';
};

export type BitrixUserLike = Pick<BitrixUser, 'id' | 'email' | 'name'>;
