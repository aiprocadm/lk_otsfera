/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-189`, `Р-Б-1`).
 *
 * Один интерфейс источника — три реализации: `rest` (входящий вебхук),
 * `file` (CSV/XLSX-выгрузки, PR-2) и `fake` (фикстура для тестов и стенда).
 * Списки отдаются постранично (`AsyncIterable`): сущности не собираются в
 * памяти целиком (`У-200`). Записи уже нормализованы — сырые ответы API
 * дальше адаптера не уходят и нигде не хранятся (`У-199`).
 */

export type BitrixUser = {
  id: string;
  email: string | null;
  name: string;
  active: boolean;
};

export type BitrixCompany = {
  id: string;
  title: string;
  inn: string | null;
  kpp: string | null;
  assignedById: string | null;
  createdAt: Date | null;
  comments: string | null;
};

export type BitrixContact = {
  id: string;
  name: string;
  lastName: string;
  post: string | null;
  companyId: string | null;
  phones: string[];
  emails: string[];
  assignedById: string | null;
  createdAt: Date | null;
};

export type BitrixLead = {
  id: string;
  title: string;
  name: string;
  companyTitle: string | null;
  phones: string[];
  emails: string[];
  inn: string | null;
  statusId: string;
  assignedById: string | null;
  opportunity: string | null;
  createdAt: Date | null;
  comments: string | null;
};

export type BitrixDeal = {
  id: string;
  title: string;
  categoryId: string;
  stageId: string;
  opportunity: string | null;
  companyId: string | null;
  contactId: string | null;
  leadId: string | null;
  assignedById: string | null;
  createdAt: Date | null;
  closeDate: Date | null;
  closed: boolean;
  comments: string | null;
};

export type BitrixStageSemantics = 'process' | 'success' | 'failure' | 'apology';

export type BitrixStage = {
  entity: 'deal' | 'lead';
  /** Направление сделок; у лидов и «общего направления» — `null`. */
  categoryId: string | null;
  id: string;
  name: string;
  semantics: BitrixStageSemantics;
};

/** Статусы задач Битрикс24: 2 — ждёт выполнения, 3 — в работе, 4 — ждёт контроля, 5 — завершена, 6 — отложена. */
export type BitrixTaskStatus = 2 | 3 | 4 | 5 | 6;

export type BitrixCrmLink = { kind: 'company' | 'deal' | 'lead' | 'contact'; id: string };

export type BitrixTask = {
  id: string;
  title: string;
  description: string | null;
  status: BitrixTaskStatus;
  responsibleId: string | null;
  createdById: string | null;
  deadline: Date | null;
  createdAt: Date | null;
  closedAt: Date | null;
  crmLinks: BitrixCrmLink[];
};

export type BitrixCommentEntity = 'deal' | 'company' | 'contact';

export type BitrixComment = {
  id: string;
  entity: BitrixCommentEntity;
  entityId: string;
  authorId: string | null;
  text: string;
  createdAt: Date | null;
};

export type BitrixFileEntity = 'deal' | 'company';

export type BitrixFile = {
  id: string;
  entity: BitrixFileEntity;
  entityId: string;
  name: string;
  size: number | null;
  downloadUrl: string | null;
};

export type SourceFilter = {
  from?: Date | undefined;
  to?: Date | undefined;
  /** Только открытые сделки и незавершённые задачи (переключатель формы пакета). */
  openOnly?: boolean | undefined;
};

export type SourceCheck =
  { ok: true; portal: string; user: string } | { ok: false; message: string };

export interface BitrixSource {
  /** Проверка подключения: домен портала и имя пользователя вебхука. Без URL. */
  check(): Promise<SourceCheck>;
  users(): AsyncIterable<BitrixUser>;
  /** Все направления и стадии сделок и статусы лидов портала. */
  stages(): Promise<BitrixStage[]>;
  companies(filter: SourceFilter): AsyncIterable<BitrixCompany>;
  contacts(filter: SourceFilter): AsyncIterable<BitrixContact>;
  leads(filter: SourceFilter): AsyncIterable<BitrixLead>;
  deals(filter: SourceFilter): AsyncIterable<BitrixDeal>;
  tasks(filter: SourceFilter): AsyncIterable<BitrixTask>;
  comments(entity: BitrixCommentEntity, ids: string[]): AsyncIterable<BitrixComment>;
  files(entity: BitrixFileEntity, ids: string[]): AsyncIterable<BitrixFile>;
  download(file: BitrixFile): Promise<Buffer>;
}

/** Коды ошибок источника — стабильные строки для UI и журнала (§3 CLAUDE.md). */
export type BitrixSourceErrorCode =
  | 'not_configured'
  | 'auth'
  | 'limit'
  | 'network'
  | 'timeout'
  | 'api'
  | 'source_not_ready'
  | 'source_no_files';

export class BitrixSourceError extends Error {
  readonly code: BitrixSourceErrorCode;

  constructor(code: BitrixSourceErrorCode, message: string) {
    super(message);
    this.name = 'BitrixSourceError';
    this.code = code;
  }
}
