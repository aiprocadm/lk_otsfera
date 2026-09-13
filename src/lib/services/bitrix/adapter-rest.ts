import { createBitrixClient, type BitrixClient, type BitrixClientOptions } from './client';
import { portalHost } from './settings';
import {
  BitrixSourceError,
  type BitrixComment,
  type BitrixCommentEntity,
  type BitrixCompany,
  type BitrixContact,
  type BitrixDeal,
  type BitrixFile,
  type BitrixFileEntity,
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
 * Источник `rest` (`У-189`): методы Битрикс24 → нормализованные записи.
 * Реквизиты компаний (ИНН/КПП) дочитываются отдельным списком
 * `crm.requisite.list`, мультиполя контактов запрашиваются явно, комментарии
 * и файлы — пакетами `batch` по 50 сущностей. Всё, что не нужно ЛК, здесь и
 * отбрасывается: дальше адаптера сырые ответы не уходят (`У-199`).
 */

type Row = Record<string, unknown>;

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const strOrNull = (v: unknown): string | null => {
  const s = str(v).trim();
  return s ? s : null;
};
const dateOrNull = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Мультиполе Битрикса: `[{ VALUE, VALUE_TYPE }]` → значения без пустых. */
const multi = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((item) => (item && typeof item === 'object' ? str((item as Row).VALUE).trim() : ''))
        .filter((s) => s.length > 0)
    : [];

const COMPANY_SELECT = ['ID', 'TITLE', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'COMMENTS'];
const CONTACT_SELECT = [
  'ID',
  'NAME',
  'LAST_NAME',
  'POST',
  'COMPANY_ID',
  'ASSIGNED_BY_ID',
  'DATE_CREATE',
  'PHONE',
  'EMAIL',
];
const LEAD_SELECT = [
  'ID',
  'TITLE',
  'NAME',
  'LAST_NAME',
  'COMPANY_TITLE',
  'STATUS_ID',
  'ASSIGNED_BY_ID',
  'OPPORTUNITY',
  'DATE_CREATE',
  'COMMENTS',
  'PHONE',
  'EMAIL',
  'UF_CRM_INN',
];
const DEAL_SELECT = [
  'ID',
  'TITLE',
  'CATEGORY_ID',
  'STAGE_ID',
  'OPPORTUNITY',
  'COMPANY_ID',
  'CONTACT_ID',
  'LEAD_ID',
  'ASSIGNED_BY_ID',
  'DATE_CREATE',
  'CLOSEDATE',
  'CLOSED',
  'COMMENTS',
];
const TASK_SELECT = [
  'ID',
  'TITLE',
  'DESCRIPTION',
  'STATUS',
  'RESPONSIBLE_ID',
  'CREATED_BY',
  'DEADLINE',
  'CREATED_DATE',
  'CLOSED_DATE',
  'UF_CRM_TASK',
];

function dateFilter(prefix: string, filter: SourceFilter): Row {
  const out: Row = {};
  if (filter.from) out[`>=${prefix}`] = filter.from.toISOString();
  if (filter.to) out[`<=${prefix}`] = filter.to.toISOString();
  return out;
}

function semanticsOf(row: Row): BitrixStageSemantics {
  const extra = row.EXTRA;
  const fromExtra =
    extra && typeof extra === 'object' ? str((extra as Row).SEMANTICS).toLowerCase() : '';
  if (
    fromExtra === 'success' ||
    fromExtra === 'failure' ||
    fromExtra === 'apology' ||
    fromExtra === 'process'
  ) {
    return fromExtra;
  }
  const short = str(row.SEMANTICS).toUpperCase();
  if (short === 'S') return 'success';
  if (short === 'F') return 'failure';
  return 'process';
}

function taskStatusOf(v: unknown): BitrixTaskStatus {
  const n = Number(str(v));
  return n === 3 || n === 4 || n === 5 || n === 6 ? n : 2;
}

/** `UF_CRM_TASK`: `CO_12` компания, `D_7` сделка, `L_3` лид, `C_9` контакт. */
function parseCrmLinks(v: unknown): BitrixTask['crmLinks'] {
  if (!Array.isArray(v)) return [];
  const out: BitrixTask['crmLinks'] = [];
  for (const item of v) {
    const m = str(item).match(/^(CO|D|L|C)_(\d+)$/);
    if (!m) continue;
    const kind =
      m[1] === 'CO' ? 'company' : m[1] === 'D' ? 'deal' : m[1] === 'L' ? 'lead' : 'contact';
    out.push({ kind, id: m[2]! });
  }
  return out;
}

export class RestBitrixSource implements BitrixSource {
  private readonly client: BitrixClient;
  private readonly host: string;

  constructor(options: BitrixClientOptions) {
    this.client = createBitrixClient(options);
    this.host = portalHost(options.webhookUrl);
  }

  async check(): Promise<SourceCheck> {
    try {
      const res = await this.client.call('profile');
      const profile = (res.result ?? {}) as Row;
      const user =
        [str(profile.NAME), str(profile.LAST_NAME)].filter(Boolean).join(' ') ||
        'пользователь вебхука';
      return { ok: true, portal: this.host, user };
    } catch (err) {
      const message = err instanceof BitrixSourceError ? err.message : 'Битрикс24 недоступен';
      return { ok: false, message };
    }
  }

  async *users(): AsyncIterable<BitrixUser> {
    for await (const row of this.client.list('user.get', {})) {
      const email = strOrNull(row.EMAIL)?.toLowerCase() ?? null;
      yield {
        id: str(row.ID),
        email,
        name:
          [str(row.NAME), str(row.LAST_NAME)]
            .map((v) => v.trim())
            .filter(Boolean)
            .join(' ') ||
          email ||
          `#${str(row.ID)}`,
        // `ACTIVE` приходит булевым (`false`) или строкой (`'N'`, `'false'`, `'0'`).
        active: isActiveFlag(row.ACTIVE),
      };
    }
  }

  async stages(): Promise<BitrixStage[]> {
    const out: BitrixStage[] = [];
    // Направления сделок: у «общего» id = 0, стадии лежат в `DEAL_STAGE`;
    // у остальных — `DEAL_STAGE_<id>`, а сами id стадий имеют вид `C<id>:NEW`.
    const categories = await this.client.call('crm.dealcategory.list', { select: ['ID', 'NAME'] });
    const categoryIds = [
      '0',
      ...(Array.isArray(categories.result)
        ? (categories.result as Row[]).map((c) => str(c.ID))
        : []),
    ];
    for (const categoryId of categoryIds) {
      const entityId = categoryId === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`;
      for await (const row of this.client.list('crm.status.list', {
        filter: { ENTITY_ID: entityId },
      })) {
        out.push({
          entity: 'deal',
          categoryId: categoryId === '0' ? null : categoryId,
          id: str(row.STATUS_ID),
          name: str(row.NAME),
          semantics: semanticsOf(row),
        });
      }
    }
    for await (const row of this.client.list('crm.status.list', {
      filter: { ENTITY_ID: 'STATUS' },
    })) {
      out.push({
        entity: 'lead',
        categoryId: null,
        id: str(row.STATUS_ID),
        name: str(row.NAME),
        semantics: semanticsOf(row),
      });
    }
    return out;
  }

  async *companies(filter: SourceFilter): AsyncIterable<BitrixCompany> {
    // Реквизиты читаются страницами по компаниям того же окна: один `batch` на
    // страницу вместо запроса на каждую компанию.
    const page: Row[] = [];
    const flush = async function* (this: RestBitrixSource): AsyncIterable<BitrixCompany> {
      if (page.length === 0) return;
      const requisites = await this.requisitesFor(page.map((c) => str(c.ID)));
      for (const row of page) {
        const id = str(row.ID);
        const rq = requisites.get(id);
        yield {
          id,
          title: str(row.TITLE).trim() || `Компания #${id}`,
          inn: rq?.inn ?? null,
          kpp: rq?.kpp ?? null,
          assignedById: strOrNull(row.ASSIGNED_BY_ID),
          createdAt: dateOrNull(row.DATE_CREATE),
          comments: strOrNull(row.COMMENTS),
        };
      }
      page.length = 0;
    }.bind(this);
    for await (const row of this.client.list('crm.company.list', {
      select: COMPANY_SELECT,
      filter: dateFilter('DATE_CREATE', filter),
      order: { ID: 'ASC' },
    })) {
      page.push(row);
      if (page.length >= 50) yield* flush();
    }
    yield* flush();
  }

  private async requisitesFor(
    companyIds: string[]
  ): Promise<Map<string, { inn: string | null; kpp: string | null }>> {
    const out = new Map<string, { inn: string | null; kpp: string | null }>();
    if (companyIds.length === 0) return out;
    for await (const row of this.client.list('crm.requisite.list', {
      filter: { ENTITY_TYPE_ID: 4, '@ENTITY_ID': companyIds },
      select: ['ENTITY_ID', 'RQ_INN', 'RQ_KPP'],
    })) {
      const entityId = str(row.ENTITY_ID);
      if (!out.has(entityId)) {
        out.set(entityId, { inn: strOrNull(row.RQ_INN), kpp: strOrNull(row.RQ_KPP) });
      }
    }
    return out;
  }

  async *contacts(filter: SourceFilter): AsyncIterable<BitrixContact> {
    for await (const row of this.client.list('crm.contact.list', {
      select: CONTACT_SELECT,
      filter: dateFilter('DATE_CREATE', filter),
      order: { ID: 'ASC' },
    })) {
      yield {
        id: str(row.ID),
        name: str(row.NAME).trim(),
        lastName: str(row.LAST_NAME).trim(),
        post: strOrNull(row.POST),
        companyId: strOrNull(row.COMPANY_ID) === '0' ? null : strOrNull(row.COMPANY_ID),
        phones: multi(row.PHONE),
        emails: multi(row.EMAIL).map((e) => e.toLowerCase()),
        assignedById: strOrNull(row.ASSIGNED_BY_ID),
        createdAt: dateOrNull(row.DATE_CREATE),
      };
    }
  }

  async *leads(filter: SourceFilter): AsyncIterable<BitrixLead> {
    for await (const row of this.client.list('crm.lead.list', {
      select: LEAD_SELECT,
      filter: dateFilter('DATE_CREATE', filter),
      order: { ID: 'ASC' },
    })) {
      yield {
        id: str(row.ID),
        title: str(row.TITLE).trim(),
        name: [str(row.NAME), str(row.LAST_NAME)]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(' '),
        companyTitle: strOrNull(row.COMPANY_TITLE),
        phones: multi(row.PHONE),
        emails: multi(row.EMAIL).map((e) => e.toLowerCase()),
        inn: strOrNull(row.UF_CRM_INN),
        statusId: str(row.STATUS_ID),
        assignedById: strOrNull(row.ASSIGNED_BY_ID),
        opportunity: strOrNull(row.OPPORTUNITY),
        createdAt: dateOrNull(row.DATE_CREATE),
        comments: strOrNull(row.COMMENTS),
      };
    }
  }

  async *deals(filter: SourceFilter): AsyncIterable<BitrixDeal> {
    const where: Row = dateFilter('DATE_CREATE', filter);
    if (filter.openOnly) where.CLOSED = 'N';
    for await (const row of this.client.list('crm.deal.list', {
      select: DEAL_SELECT,
      filter: where,
      order: { ID: 'ASC' },
    })) {
      const companyId = strOrNull(row.COMPANY_ID);
      const contactId = strOrNull(row.CONTACT_ID);
      const leadId = strOrNull(row.LEAD_ID);
      yield {
        id: str(row.ID),
        title: str(row.TITLE).trim(),
        categoryId: str(row.CATEGORY_ID) || '0',
        stageId: str(row.STAGE_ID),
        opportunity: strOrNull(row.OPPORTUNITY),
        companyId: companyId === '0' ? null : companyId,
        contactId: contactId === '0' ? null : contactId,
        leadId: leadId === '0' ? null : leadId,
        assignedById: strOrNull(row.ASSIGNED_BY_ID),
        createdAt: dateOrNull(row.DATE_CREATE),
        closeDate: dateOrNull(row.CLOSEDATE),
        closed: str(row.CLOSED) === 'Y',
        comments: strOrNull(row.COMMENTS),
      };
    }
  }

  async *tasks(filter: SourceFilter): AsyncIterable<BitrixTask> {
    const where: Row = dateFilter('CREATED_DATE', filter);
    if (filter.openOnly) where['!REAL_STATUS'] = 5;
    for await (const row of this.client.list('tasks.task.list', {
      select: TASK_SELECT,
      filter: where,
      order: { ID: 'asc' },
    })) {
      // `tasks.task.list` отдаёт поля в camelCase (`id`, `title`, …) — читаем оба варианта.
      const get = (upper: string, lower: string) =>
        row[upper] !== undefined ? row[upper] : row[lower];
      yield {
        id: str(get('ID', 'id')),
        title: str(get('TITLE', 'title')).trim() || `Задача #${str(get('ID', 'id'))}`,
        description: strOrNull(get('DESCRIPTION', 'description')),
        status: taskStatusOf(get('STATUS', 'status')),
        responsibleId: strOrNull(get('RESPONSIBLE_ID', 'responsibleId')),
        createdById: strOrNull(get('CREATED_BY', 'createdBy')),
        deadline: dateOrNull(get('DEADLINE', 'deadline')),
        createdAt: dateOrNull(get('CREATED_DATE', 'createdDate')),
        closedAt: dateOrNull(get('CLOSED_DATE', 'closedDate')),
        crmLinks: parseCrmLinks(get('UF_CRM_TASK', 'ufCrmTask')),
      };
    }
  }

  async *comments(entity: BitrixCommentEntity, ids: string[]): AsyncIterable<BitrixComment> {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const commands = Object.fromEntries(
        chunk.map((id) => [
          `c${id}`,
          `crm.timeline.comment.list?filter[ENTITY_TYPE]=${entity}&filter[ENTITY_ID]=${id}&order[ID]=ASC`,
        ])
      );
      const results = await this.client.batch(commands);
      for (const id of chunk) {
        const rows = results[`c${id}`];
        if (!Array.isArray(rows)) continue;
        for (const row of rows as Row[]) {
          const text = str(row.COMMENT).trim();
          if (!text) continue;
          yield {
            id: str(row.ID),
            entity,
            entityId: id,
            authorId: strOrNull(row.AUTHOR_ID),
            text,
            createdAt: dateOrNull(row.CREATED),
          };
        }
      }
    }
  }

  async *files(entity: BitrixFileEntity, ids: string[]): AsyncIterable<BitrixFile> {
    // Файлы сущности лежат в таймлайне комментариев (`FILES`) — второй проход
    // тем же списком; `disk.file.get` даёт имя, размер и ссылку скачивания.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const commands = Object.fromEntries(
        chunk.map((id) => [
          `f${id}`,
          `crm.timeline.comment.list?filter[ENTITY_TYPE]=${entity}&filter[ENTITY_ID]=${id}&select[]=ID&select[]=FILES`,
        ])
      );
      const results = await this.client.batch(commands);
      const attached: { entityId: string; fileId: string }[] = [];
      for (const id of chunk) {
        const rows = results[`f${id}`];
        if (!Array.isArray(rows)) continue;
        for (const row of rows as Row[]) {
          const files = row.FILES;
          if (!files || typeof files !== 'object') continue;
          for (const f of Object.values(files as Record<string, unknown>)) {
            const fileId = f && typeof f === 'object' ? str((f as Row).id ?? (f as Row).ID) : '';
            if (fileId) attached.push({ entityId: id, fileId });
          }
        }
      }
      for (let j = 0; j < attached.length; j += 50) {
        const part = attached.slice(j, j + 50);
        const infos = await this.client.batch(
          Object.fromEntries(
            part.map((a) => [`d${a.fileId}`, `disk.attachedObject.get?id=${a.fileId}`])
          )
        );
        for (const a of part) {
          const info = infos[`d${a.fileId}`] as Row | undefined;
          if (!info) continue;
          yield {
            id: str(info.ID ?? info.OBJECT_ID ?? a.fileId),
            entity,
            entityId: a.entityId,
            name: str(info.NAME) || `file-${a.fileId}`,
            size: toSize(info.SIZE),
            downloadUrl: strOrNull(info.DOWNLOAD_URL),
          };
        }
      }
    }
  }

  async download(file: BitrixFile): Promise<Buffer> {
    if (!file.downloadUrl)
      throw new BitrixSourceError('api', `У файла «${file.name}» нет ссылки скачивания`);
    const res = await fetch(file.downloadUrl);
    if (!res.ok)
      throw new BitrixSourceError('api', `Файл «${file.name}» не скачался: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

function toSize(v: unknown): number | null {
  const raw = str(v).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Уволенный сотрудник Битрикса не должен стать «активным» из-за булевого `false`. */
function isActiveFlag(v: unknown): boolean {
  if (v === false) return false;
  const raw = str(v).trim().toLowerCase();
  return raw !== 'false' && raw !== 'n' && raw !== '0';
}
