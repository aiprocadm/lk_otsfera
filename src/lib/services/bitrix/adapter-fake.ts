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
  type BitrixTask,
  type BitrixUser,
  type SourceCheck,
  type SourceFilter,
} from './source';
import {
  FAKE_COMMENTS,
  FAKE_COMPANIES,
  FAKE_CONTACTS,
  FAKE_DEALS,
  FAKE_FILES,
  FAKE_LEADS,
  FAKE_PDF,
  FAKE_PORTAL,
  FAKE_STAGES,
  FAKE_TASKS,
  FAKE_USERS,
} from './fixtures/portal';

/**
 * Источник `fake` (`У-203`): фикстура портала в памяти — для тестов и стенда
 * (`FAKE_BITRIX=1`). Отдаёт ровно то, что отдал бы REST: постранично, с
 * фильтром по дате и «только открытые». Детерминирован: тесты сравнивают
 * сводки с ожидаемыми числами.
 */
export class FakeBitrixSource implements BitrixSource {
  async check(): Promise<SourceCheck> {
    return { ok: true, portal: FAKE_PORTAL, user: 'Фикстура Битрикс24' };
  }

  async *users(): AsyncIterable<BitrixUser> {
    yield* FAKE_USERS;
  }

  async stages(): Promise<BitrixStage[]> {
    return FAKE_STAGES;
  }

  async *companies(filter: SourceFilter): AsyncIterable<BitrixCompany> {
    yield* FAKE_COMPANIES.filter((c) => inRange(c.createdAt, filter));
  }

  async *contacts(filter: SourceFilter): AsyncIterable<BitrixContact> {
    yield* FAKE_CONTACTS.filter((c) => inRange(c.createdAt, filter));
  }

  async *leads(filter: SourceFilter): AsyncIterable<BitrixLead> {
    yield* FAKE_LEADS.filter((l) => inRange(l.createdAt, filter));
  }

  async *deals(filter: SourceFilter): AsyncIterable<BitrixDeal> {
    yield* FAKE_DEALS.filter(
      (d) => inRange(d.createdAt, filter) && (!filter.openOnly || !d.closed)
    );
  }

  async *tasks(filter: SourceFilter): AsyncIterable<BitrixTask> {
    yield* FAKE_TASKS.filter(
      (t) => inRange(t.createdAt, filter) && (!filter.openOnly || t.status !== 5)
    );
  }

  async *comments(entity: BitrixCommentEntity, ids: string[]): AsyncIterable<BitrixComment> {
    const wanted = new Set(ids);
    // Как и REST: пустые комментарии (в фикстуре — `610`) наружу не выходят.
    yield* FAKE_COMMENTS.filter(
      (c) => c.entity === entity && wanted.has(c.entityId) && c.text.trim().length > 0
    );
  }

  async *files(entity: BitrixFileEntity, ids: string[]): AsyncIterable<BitrixFile> {
    const wanted = new Set(ids);
    yield* FAKE_FILES.filter((f) => f.entity === entity && wanted.has(f.entityId));
  }

  async download(file: BitrixFile): Promise<Buffer> {
    if (!FAKE_FILES.some((f) => f.id === file.id)) {
      throw new BitrixSourceError('api', `Файл «${file.name}» не найден в фикстуре`);
    }
    return Buffer.from(FAKE_PDF, 'utf8');
  }
}

function inRange(createdAt: Date | null, filter: SourceFilter): boolean {
  if (!createdAt) return true;
  if (filter.from && createdAt < filter.from) return false;
  if (filter.to && createdAt > filter.to) return false;
  return true;
}
