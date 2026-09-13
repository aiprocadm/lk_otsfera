import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';
import { normalizeLabel } from '@/lib/services/import/normalize';
import {
  cellDate,
  cellDigitsOrNull,
  cellFlag,
  cellList,
  cellMoney,
  cellText,
  cellTextOrNull,
} from './cells';
import {
  detectEntityByHeaders,
  resolveBitrixColumns,
  type BitrixField,
  type BitrixFileDiagnostic,
  type BitrixFileEntity,
  type ResolvedColumns,
} from './column-map';
import { parseCrmLinks } from './crm-links';
import { inCreatedRange } from './filter';
import {
  BitrixSourceError,
  type BitrixComment,
  type BitrixCompany,
  type BitrixContact,
  type BitrixDeal,
  type BitrixFile,
  type BitrixLead,
  type BitrixSource,
  type BitrixStage,
  type BitrixStageSemantics,
  type BitrixTask,
  type BitrixTaskStatus,
  type BitrixUser,
  type SourceCheck,
  type SourceFilter,
} from './source';

/**
 * Источник `file` (`У-189`): выгрузки Битрикс24 по сущностям — CSV (`;` или
 * `,`, UTF-8 с BOM или Windows-1251) и XLSX, обе через `exceljs` (`Д-49`).
 * Сущность каждого файла определяется по шапке ещё при загрузке
 * (`column-map.ts`); здесь файлы читаются один раз, лениво, и отдаются тем же
 * контрактом, что REST и фикстура. Связи, которых в выгрузке нет как ID
 * (компания контакта, контакт сделки, ответственный), восстанавливаются по
 * названию/имени из соседних файлов; не нашлось — `null`, а не выдумка.
 * Таймлайна и вложений в выгрузке нет: `comments`/`files` пусты, `download`
 * — `source_no_files` (счётчик «источник не даёт файлов» в отчёте).
 */
export type BitrixUploadedFile = { entity: BitrixFileEntity; buffer: Buffer; fileName: string };

type Grid = { headers: unknown[]; rows: unknown[][] };

type Parsed = {
  diagnostics: BitrixFileDiagnostic[];
  users: BitrixUser[];
  stages: BitrixStage[];
  companies: BitrixCompany[];
  contacts: BitrixContact[];
  leads: BitrixLead[];
  deals: BitrixDeal[];
  tasks: BitrixTask[];
};

const XLSX_MAGIC = [0x50, 0x4b] as const;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  return buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
}

function unreadable(fileName: string, why: string): BitrixSourceError {
  return new BitrixSourceError('file_unreadable', `Файл «${fileName}»: ${why}`);
}

function worksheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const width = Math.max(ws.columnCount, row.cellCount);
    const cells: unknown[] = [];
    for (let c = 1; c <= width; c++) cells.push(row.getCell(c).value ?? null);
    rows.push(cells);
  }
  return rows;
}

async function xlsxRows(buffer: Buffer, fileName: string): Promise<unknown[][]> {
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadXlsxWorkbook(buffer);
  } catch {
    throw unreadable(fileName, 'книга Excel повреждена или это не XLSX');
  }
  const ws = wb.worksheets.find((s) => s.rowCount > 0);
  return ws ? worksheetRows(ws) : [];
}

/** Текст CSV: BOM → UTF-8; иначе UTF-8, если декодируется без ошибок, иначе Windows-1251 (второй вариант экспорта Битрикса). */
function decodeCsv(buffer: Buffer): string {
  if (startsWith(buffer, UTF8_BOM)) return buffer.subarray(UTF8_BOM.length).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1251').decode(buffer);
  }
}

/** Разделитель — по первой строке: чего больше (`;` у русского портала, `,` у английского, таб у копии из Excel). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates: Array<[string, number]> = [';', ',', '\t'].map((d) => [
    d,
    firstLine.split(d).length - 1,
  ]);
  candidates.sort((a, b) => b[1] - a[1]);
  const best = candidates[0];
  return best && best[1] > 0 ? best[0] : ';';
}

async function csvRows(buffer: Buffer, fileName: string): Promise<unknown[][]> {
  const text = decodeCsv(buffer);
  const delimiter = detectDelimiter(text);
  let ws: ExcelJS.Worksheet;
  try {
    ws = await new ExcelJS.Workbook().csv.read(Readable.from([Buffer.from(text, 'utf8')]), {
      // Значения остаются строками: разбор чисел/дат — дело `cells.ts`, а не
      // угадывание exceljs (иначе ИНН «0123…» превратился бы в число).
      map: (value: unknown) => value,
      parserOptions: { delimiter, ignoreEmpty: true },
    });
  } catch (e) {
    throw unreadable(fileName, e instanceof Error ? e.message : 'CSV не разобран');
  }
  return worksheetRows(ws);
}

/** Сетка файла: первая непустая строка — шапка, остальные — записи. */
async function readBitrixGrid(buffer: Buffer, fileName: string): Promise<Grid> {
  const rows = startsWith(buffer, XLSX_MAGIC)
    ? await xlsxRows(buffer, fileName)
    : await csvRows(buffer, fileName);
  const nonEmpty = rows.filter((r) => r.some((c) => cellText(c) !== ''));
  const [headers, ...body] = nonEmpty;
  if (!headers) throw unreadable(fileName, 'пустой файл — нет строки с шапкой');
  return { headers, rows: body };
}

/** Диагностика одного файла для формы загрузки: сущность по шапке, лишние и недостающие колонки, число строк. */
export async function inspectBitrixFile(
  buffer: Buffer,
  fileName: string
): Promise<BitrixFileDiagnostic> {
  const grid = await readBitrixGrid(buffer, fileName);
  const detection = detectEntityByHeaders(grid.headers);
  return {
    name: fileName,
    entity: detection.entity,
    candidate: detection.candidate,
    rows: grid.rows.length,
    unmatchedHeaders: detection.unmatched,
    missing: detection.missing,
  };
}

// ---------------------------------------------------------------------------
// Разбор записей
// ---------------------------------------------------------------------------

function rowReader<E extends BitrixFileEntity>(index: ResolvedColumns<E>['index'], row: unknown[]) {
  const raw = (f: BitrixField<E>): unknown => {
    const col = index[f]?.[0];
    return col === undefined ? undefined : row[col];
  };
  return {
    raw,
    has: (f: BitrixField<E>) => index[f] !== undefined,
    text: (f: BitrixField<E>) => cellText(raw(f)),
    textOrNull: (f: BitrixField<E>) => cellTextOrNull(raw(f)),
    digits: (f: BitrixField<E>) => cellDigitsOrNull(raw(f)),
    date: (f: BitrixField<E>) => cellDate(raw(f)),
    flag: (f: BitrixField<E>) => cellFlag(raw(f)),
    money: (f: BitrixField<E>) => cellMoney(raw(f)),
    list: (f: BitrixField<E>) => (index[f] ?? []).flatMap((i) => cellList(row[i])),
  };
}

/**
 * Пользователи портала по колонкам «Ответственный»/«Постановщик». Есть колонка
 * с ID — пользователь под своим ID; нет — под ключом `name:<имя>` (e-mail
 * неизвестен, предпросмотр покажет «не сопоставлен»).
 */
class UserBook {
  private readonly byId = new Map<string, BitrixUser>();

  add(id: string | null, name: string | null): string | null {
    const key = id ?? (name ? `name:${normalizeLabel(name)}` : null);
    if (!key) return null;
    const existing = this.byId.get(key);
    if (!existing) {
      this.byId.set(key, { id: key, email: null, name: name ?? key, active: true });
    } else if (name && existing.name === key) {
      existing.name = name;
    }
    return key;
  }

  list(): BitrixUser[] {
    return [...this.byId.values()];
  }
}

/** Связь «по ID, а если ID не выгружен — по названию/имени из соседнего файла». */
class LinkBook {
  private readonly byKey = new Map<string, string>();

  register(id: string, ...labels: string[]): void {
    for (const label of labels) {
      const key = normalizeLabel(label);
      if (key && !this.byKey.has(key)) this.byKey.set(key, id);
    }
  }

  resolve(id: string | null, label: string | null): string | null {
    if (id) return id;
    if (!label) return null;
    return this.byKey.get(normalizeLabel(label)) ?? null;
  }
}

const SUCCESS_STAGES = new Set([
  'won',
  'сделка успешна',
  'успешна',
  'deal won',
  'success',
  'converted',
  'качественный лид',
  'сконвертирован',
  'good lead',
]);
const FAILURE_STAGES = new Set([
  'lose',
  'lost',
  'сделка провалена',
  'провалена',
  'deal lost',
  'failure',
  'junk',
  'некачественный лид',
  'junk lead',
  'bad lead',
]);
const APOLOGY_STAGES = new Set(['apology', 'анализ причины провала']);

/** Семантика стадии по ID (`C1:WON` → `WON`) или названию; всё незнакомое — `process` (человек сопоставит вручную, `В-2-9`). */
function stageSemantics(id: string, name: string | null): BitrixStageSemantics {
  const keys = [normalizeLabel(id.replace(/^C\d+:/i, '')), name ? normalizeLabel(name) : ''];
  if (keys.some((k) => SUCCESS_STAGES.has(k))) return 'success';
  if (keys.some((k) => FAILURE_STAGES.has(k))) return 'failure';
  if (keys.some((k) => APOLOGY_STAGES.has(k))) return 'apology';
  return 'process';
}

class StageBook {
  private readonly byKey = new Map<string, BitrixStage>();

  add(entity: BitrixStage['entity'], categoryId: string | null, id: string, name: string | null) {
    if (!id) return;
    const key = `${entity}|${categoryId ?? ''}|${id}`;
    if (this.byKey.has(key)) return;
    this.byKey.set(key, {
      entity,
      categoryId,
      id,
      name: name ?? id,
      semantics: stageSemantics(id, name),
    });
  }

  list(): BitrixStage[] {
    return [...this.byKey.values()];
  }
}

const TASK_STATUS_NAMES: Array<[BitrixTaskStatus, string[]]> = [
  [3, ['выполняется', 'в работе', 'in progress']],
  [
    4,
    [
      'ждет контроля',
      'ожидает контроля',
      'на контроле',
      'awaiting control',
      'supposedly completed',
    ],
  ],
  [5, ['завершена', 'выполнена', 'закрыта', 'completed', 'closed', 'done']],
  [6, ['отложена', 'deferred', 'postponed']],
];

/** Статус задачи: код 2..6 или название колонки «Статус»; незнакомое → 2 («ждёт выполнения»). */
function taskStatusOf(raw: string): BitrixTaskStatus {
  const n = Number(raw);
  if (n === 3 || n === 4 || n === 5 || n === 6) return n;
  const key = normalizeLabel(raw);
  for (const [status, names] of TASK_STATUS_NAMES) if (names.includes(key)) return status;
  return 2;
}

const joinName = (...parts: string[]): string => parts.filter(Boolean).join(' ').trim();

type Books = { users: UserBook; stages: StageBook; companies: LinkBook; contacts: LinkBook };

function parseCompanies(grid: Grid, books: Books): BitrixCompany[] {
  const { index } = resolveBitrixColumns('company', grid.headers);
  const out: BitrixCompany[] = [];
  for (const row of grid.rows) {
    const r = rowReader<'company'>(index, row);
    const id = r.text('id');
    if (!id) continue;
    const title = r.text('title');
    books.companies.register(id, title);
    out.push({
      id,
      title,
      inn: r.digits('inn'),
      kpp: r.digits('kpp'),
      assignedById: books.users.add(r.textOrNull('assignedById'), r.textOrNull('assignedByName')),
      createdAt: r.date('createdAt'),
      comments: r.textOrNull('comments'),
    });
  }
  return out;
}

function parseContacts(grid: Grid, books: Books): BitrixContact[] {
  const { index } = resolveBitrixColumns('contact', grid.headers);
  const out: BitrixContact[] = [];
  for (const row of grid.rows) {
    const r = rowReader<'contact'>(index, row);
    const id = r.text('id');
    if (!id) continue;
    const name = r.text('name');
    const lastName = r.text('lastName');
    books.contacts.register(id, joinName(name, lastName), joinName(lastName, name));
    out.push({
      id,
      name,
      lastName,
      post: r.textOrNull('post'),
      companyId: books.companies.resolve(r.textOrNull('companyId'), r.textOrNull('companyTitle')),
      phones: r.list('phones'),
      emails: r.list('emails'),
      assignedById: books.users.add(r.textOrNull('assignedById'), r.textOrNull('assignedByName')),
      createdAt: r.date('createdAt'),
    });
  }
  return out;
}

function parseLeads(grid: Grid, books: Books): BitrixLead[] {
  const { index } = resolveBitrixColumns('lead', grid.headers);
  const out: BitrixLead[] = [];
  for (const row of grid.rows) {
    const r = rowReader<'lead'>(index, row);
    const id = r.text('id');
    if (!id) continue;
    const statusName = r.textOrNull('statusName');
    const statusId = r.textOrNull('statusId') ?? statusName ?? '';
    books.stages.add('lead', null, statusId, statusName);
    out.push({
      id,
      title: r.text('title'),
      name: joinName(r.text('name'), r.text('lastName')),
      companyTitle: r.textOrNull('companyTitle'),
      phones: r.list('phones'),
      emails: r.list('emails'),
      inn: r.digits('inn'),
      statusId,
      assignedById: books.users.add(r.textOrNull('assignedById'), r.textOrNull('assignedByName')),
      opportunity: r.money('opportunity'),
      createdAt: r.date('createdAt'),
      comments: r.textOrNull('comments'),
    });
  }
  return out;
}

function parseDeals(grid: Grid, books: Books): BitrixDeal[] {
  const { index } = resolveBitrixColumns('deal', grid.headers);
  const out: BitrixDeal[] = [];
  for (const row of grid.rows) {
    const r = rowReader<'deal'>(index, row);
    const id = r.text('id');
    if (!id) continue;
    const categoryId = r.textOrNull('categoryId') ?? '0';
    const stageName = r.textOrNull('stageName');
    const stageId = r.textOrNull('stageId') ?? stageName ?? '';
    // Направление «0» — общее: у его стадий `categoryId: null`, как в REST.
    books.stages.add('deal', categoryId === '0' ? null : categoryId, stageId, stageName);
    const semantics = stageSemantics(stageId, stageName);
    out.push({
      id,
      title: r.text('title'),
      categoryId,
      stageId,
      opportunity: r.money('opportunity'),
      companyId: books.companies.resolve(r.textOrNull('companyId'), r.textOrNull('companyTitle')),
      contactId: books.contacts.resolve(r.textOrNull('contactId'), r.textOrNull('contactName')),
      leadId: r.textOrNull('leadId'),
      assignedById: books.users.add(r.textOrNull('assignedById'), r.textOrNull('assignedByName')),
      createdAt: r.date('createdAt'),
      closeDate: r.date('closeDate'),
      // Нет колонки «Сделка закрыта» — закрытость выводится из семантики стадии.
      closed: r.has('closed') ? r.flag('closed') : semantics !== 'process',
      comments: r.textOrNull('comments'),
    });
  }
  return out;
}

function parseTasks(grid: Grid, books: Books): BitrixTask[] {
  const { index } = resolveBitrixColumns('task', grid.headers);
  const out: BitrixTask[] = [];
  for (const row of grid.rows) {
    const r = rowReader<'task'>(index, row);
    const id = r.text('id');
    if (!id) continue;
    out.push({
      id,
      title: r.text('title'),
      description: r.textOrNull('description'),
      status: taskStatusOf(r.text('status')),
      responsibleId: books.users.add(
        r.textOrNull('responsibleId'),
        r.textOrNull('responsibleName')
      ),
      createdById: books.users.add(r.textOrNull('createdById'), r.textOrNull('createdByName')),
      deadline: r.date('deadline'),
      createdAt: r.date('createdAt'),
      closedAt: r.date('closedAt'),
      crmLinks: parseCrmLinks(cellList(r.raw('crm'))),
    });
  }
  return out;
}

/** Порядок разбора: сначала то, на что ссылаются остальные (компании → контакты → лиды → сделки → задачи). */
const ORDER: readonly BitrixFileEntity[] = ['company', 'contact', 'lead', 'deal', 'task'];

async function parseAll(files: readonly BitrixUploadedFile[]): Promise<Parsed> {
  const grids = new Map<BitrixFileEntity, Grid[]>();
  const diagnostics: BitrixFileDiagnostic[] = [];
  for (const file of files) {
    const grid = await readBitrixGrid(file.buffer, file.fileName);
    const resolved = resolveBitrixColumns(file.entity, grid.headers);
    diagnostics.push({
      name: file.fileName,
      entity: file.entity,
      candidate: file.entity,
      rows: grid.rows.length,
      unmatchedHeaders: resolved.unmatched,
      missing: resolved.missing,
    });
    grids.set(file.entity, [...(grids.get(file.entity) ?? []), grid]);
  }
  const books: Books = {
    users: new UserBook(),
    stages: new StageBook(),
    companies: new LinkBook(),
    contacts: new LinkBook(),
  };
  const parsed: Parsed = {
    diagnostics,
    users: [],
    stages: [],
    companies: [],
    contacts: [],
    leads: [],
    deals: [],
    tasks: [],
  };
  for (const entity of ORDER) {
    for (const grid of grids.get(entity) ?? []) {
      if (entity === 'company') parsed.companies.push(...parseCompanies(grid, books));
      else if (entity === 'contact') parsed.contacts.push(...parseContacts(grid, books));
      else if (entity === 'lead') parsed.leads.push(...parseLeads(grid, books));
      else if (entity === 'deal') parsed.deals.push(...parseDeals(grid, books));
      else parsed.tasks.push(...parseTasks(grid, books));
    }
  }
  parsed.users = books.users.list();
  parsed.stages = books.stages.list();
  return parsed;
}

// ---------------------------------------------------------------------------
// Источник
// ---------------------------------------------------------------------------

export class FileBitrixSource implements BitrixSource {
  private readonly uploads: readonly BitrixUploadedFile[];
  private loaded: Promise<Parsed> | null = null;

  constructor(uploads: readonly BitrixUploadedFile[]) {
    this.uploads = uploads;
  }

  private load(): Promise<Parsed> {
    this.loaded ??= parseAll(this.uploads);
    return this.loaded;
  }

  async check(): Promise<SourceCheck> {
    if (this.uploads.length === 0) {
      return { ok: false, message: 'Не загружено ни одного файла выгрузки' };
    }
    try {
      await this.load();
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, portal: 'Файлы выгрузки Битрикс24', user: `файлов: ${this.uploads.length}` };
  }

  /** Что распозналось в каждом файле — для формы загрузки и отчёта пакета. */
  async diagnostics(): Promise<BitrixFileDiagnostic[]> {
    return (await this.load()).diagnostics;
  }

  async *users(): AsyncIterable<BitrixUser> {
    yield* (await this.load()).users;
  }

  async stages(): Promise<BitrixStage[]> {
    return (await this.load()).stages;
  }

  async *companies(filter: SourceFilter): AsyncIterable<BitrixCompany> {
    yield* (await this.load()).companies.filter((c) => inCreatedRange(c.createdAt, filter));
  }

  async *contacts(filter: SourceFilter): AsyncIterable<BitrixContact> {
    yield* (await this.load()).contacts.filter((c) => inCreatedRange(c.createdAt, filter));
  }

  async *leads(filter: SourceFilter): AsyncIterable<BitrixLead> {
    yield* (await this.load()).leads.filter((l) => inCreatedRange(l.createdAt, filter));
  }

  async *deals(filter: SourceFilter): AsyncIterable<BitrixDeal> {
    yield* (await this.load()).deals.filter(
      (d) => inCreatedRange(d.createdAt, filter) && (!filter.openOnly || !d.closed)
    );
  }

  async *tasks(filter: SourceFilter): AsyncIterable<BitrixTask> {
    yield* (await this.load()).tasks.filter(
      (t) => inCreatedRange(t.createdAt, filter) && (!filter.openOnly || t.status !== 5)
    );
  }

  // Выгрузка не содержит таймлайна и вложений — списки пусты по контракту.
  async *comments(): AsyncIterable<BitrixComment> {
    yield* [];
  }

  async *files(): AsyncIterable<BitrixFile> {
    yield* [];
  }

  async download(file: BitrixFile): Promise<Buffer> {
    throw new BitrixSourceError(
      'source_no_files',
      `Файловый источник не отдаёт вложения («${file.name}»)`
    );
  }
}
