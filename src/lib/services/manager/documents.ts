import { z } from 'zod';
import type {
  PrismaClient,
  Prisma,
  DocumentType,
  DocumentDirection,
  DocumentStatus,
  OneCPushStatus,
} from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { moscowYearRange } from '@/lib/dates/calendar';
import {
  managerDocumentScope,
  canSeeOrder,
  getCompanyTeamVisibility,
} from '@/lib/auth/managerPolicy';
import { managerOrderLessWhere, canReadOrderLessDocument } from '@/lib/auth/documentChannelPolicy';
import { documentDownloadName } from '@/lib/documents/fileName';
import { documentSourceWhere, isDocumentSource, type DocumentSource } from '@/lib/documents/source';

/**
 * Manager-facing documents service.
 *
 * Visibility delegates to `managerDocumentScopeFilter`, which is the three-way
 * RBAC scope from `managerOrderScopeFilter` (per-order managerId, per-org
 * assignment, historical comments) plus `scanStatus != 'infected'` so that
 * managers never see ClamAV-flagged files. Platform admins use a different
 * code path; this service is only invoked from the manager cabinet.
 *
 * The download helper performs an additional in-process RBAC check after
 * fetching the document by id so a foreign-org document returns `not_found`
 * silently (no existence-leak) even though the prisma fetch crosses scope.
 */

const ListDocumentsOptionsSchema = z.object({
  session: z.custom<SessionPayload>((v) => !!v && typeof v === 'object' && 'sub' in (v as object)),
  search: z.string().optional(),
  orderId: z.string().optional(),
  type: z.string().optional(),
  // `У-169`: фильтр «Выгрузка в 1С». Значение уже разобрано страницей
  // (`parseOneCPushStatus`) — чужое слово из адреса сюда не доходит.
  oneCPushStatus: z.custom<OneCPushStatus>((v) => typeof v === 'string').optional(),
  // `У-253`: четыре фильтра «файлового шкафа». Значения приходят уже
  // разобранными страницей — чужое слово из адреса сюда не доходит.
  /** Год создания документа (по `createdAt`). */
  year: z.number().int().min(2000).max(2100).optional(),
  direction: z.enum(['incoming', 'outgoing']).optional(),
  status: z.string().optional(),
  /** `У-258`: откуда документ взялся. Условие даёт `documentSourceWhere`. */
  source: z.custom<DocumentSource>((v) => typeof v === 'string' && isDocumentSource(v)).optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  // `У-110`: кабинет руководителя форсит company-wide независимо от toggle —
  // тот же приём, что у `listOrders`. Личный /manager-кабинет руководителя
  // («играющий тренер») остаётся scoped, поэтому это override, а не роль.
  teamModeOverride: z.boolean().optional(),
});

export type ListDocumentsOptions = z.input<typeof ListDocumentsOptionsSchema>;

const LIST_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      title: true,
      managerId: true,
      organizationId: true,
    },
  },
  // `У-258`: источник документа считается по роли загрузившего — без неё
  // «загружен клиентом» и «загружен сотрудником» неразличимы.
  uploadedBy: { select: { role: true } },
} satisfies Prisma.DocumentInclude;

type ManagerDocumentRow = Prisma.DocumentGetPayload<{ include: typeof LIST_INCLUDE }>;

export type ListDocumentsResult = {
  rows: ManagerDocumentRow[];
  nextCursor: string | null;
  /**
   * `У-253`: сколько документов под фильтром ВСЕГО. «Показано 50» без «из 340»
   * человек читает как «их пятьдесят» — и уходит, не найдя нужного.
   *
   * Считается отдельным `count` по тому же условию (`Р-Э8-8`). Это второй
   * запрос, но дешёвый: курсорную постраничность он не ломает, а она стоит на
   * стабильном порядке и менять её ради общего числа нельзя.
   */
  total: number;
};

export async function listDocuments(
  prisma: PrismaClient,
  optsRaw: ListDocumentsOptions
): Promise<ListDocumentsResult> {
  const opts = ListDocumentsOptionsSchema.parse(optsRaw);
  const teamMode =
    opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));
  const scope = managerDocumentScope(opts.session, teamMode);
  const filters: Prisma.DocumentWhereInput[] = [scope];
  if (opts.orderId) filters.push({ orderId: opts.orderId });
  if (opts.type) filters.push({ type: opts.type as DocumentType });
  if (opts.oneCPushStatus) filters.push({ oneCPushStatus: opts.oneCPushStatus });
  if (opts.direction) filters.push({ direction: opts.direction });
  if (opts.status) filters.push({ status: opts.status as DocumentStatus });
  if (opts.source) filters.push(documentSourceWhere(opts.source));
  if (opts.year !== undefined) {
    // Прогон сопровождения №36: год — московский, «с 1 января по 1 января
    // следующего» полуоткрыто, чтобы последний день попал целиком. Границы по
    // Гринвичу относили документ, выпущенный 1 января в 01:30 МСК, к прошлому
    // году, а список лет на экране (`documentYearOptions`) уже считается по Москве.
    filters.push({ createdAt: moscowYearRange(opts.year) });
  }
  if (opts.search) {
    /**
     * `У-253`: ищем по имени файла И по номеру документа.
     *
     * До этапа 8 поиск смотрел только на имя файла. Человек вводил номер
     * счёта, не находил ничего и делал вывод, что счёта нет, — хотя счёт
     * лежал рядом под именем вроде `scan_0012.pdf`.
     */
    filters.push({
      OR: [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { number: { contains: opts.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.DocumentWhereInput = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { id: 'desc' },
      take: opts.take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    }),
    prisma.document.count({ where }),
  ]);

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor, total };
}

export type DownloadResult =
  | {
      ok: true;
      path: string;
      mimeType: string;
      name: string;
      downloadName: string;
      version: number;
    }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'infected'; scanReason: string | null };

export async function getDocumentForDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<DownloadResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      // `У-254`: версия нужна журналу скачиваний — «скачал документ» без
      // версии не отвечает на вопрос, какую именно бумагу человек получил.
      version: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      // `У-154`: имя файла при скачивании собирается по типу, номеру и дате.
      type: true,
      number: true,
      createdAt: true,
      order: {
        select: {
          managerId: true,
          organizationId: true,
          companyId: true,
        },
      },
    },
  });

  if (!doc) return { ok: false, error: 'not_found' };

  if (doc.orderId === null) {
    if (
      !canReadOrderLessDocument(session, {
        counterpartyType: doc.counterpartyType,
        counterpartyId: doc.counterpartyId,
        companyId: doc.companyId ?? null,
      })
    ) {
      return { ok: false, error: 'not_found' };
    }
    if (doc.scanStatus === 'infected')
      return { ok: false, error: 'infected', scanReason: doc.scanReason ?? null };
    return {
      ok: true,
      path: doc.path,
      mimeType: doc.mimeType,
      name: doc.name,
      version: doc.version,
      downloadName: documentDownloadName(doc),
    };
  }

  const ord = doc.order!;

  // Silent 404 for out-of-scope documents: do not leak existence. In company-wide
  // mode the cheap companyId check decides, so we skip the historical-comment
  // count entirely; in scoped mode we count comments only when managerId/org miss.
  let commentsCountByMe = 0;
  if (
    !teamMode &&
    ord.managerId !== session.sub &&
    !(ord.organizationId && (session.managedOrgIds ?? []).includes(ord.organizationId))
  ) {
    commentsCountByMe = await prisma.comment.count({
      where: { order: { documents: { some: { id: documentId } } }, authorId: session.sub },
    });
  }

  if (!canSeeOrder(session, { ...ord, commentsCountByMe }, teamMode)) {
    return { ok: false, error: 'not_found' };
  }

  if (doc.scanStatus === 'infected') {
    return { ok: false, error: 'infected', scanReason: doc.scanReason ?? null };
  }

  return {
    ok: true,
    path: doc.path,
    mimeType: doc.mimeType,
    name: doc.name,
    version: doc.version,
    downloadName: documentDownloadName(doc),
  };
}

export type ManagerOrderLessRow = {
  /** `У-154`: номер и версия выпущенного документа. */
  number: string | null;
  version: number;
  id: string;
  name: string;
  type: DocumentType;
  direction: DocumentDirection;
  signedAt: Date | null;
  createdAt: Date;
  size: number | null;
  counterpartyType: 'organization' | 'partner';
  counterpartyId: string;
  /** `У-169`: состояние выгрузки в 1С — бейдж и флажок массовой выгрузки. */
  oneCPushStatus: OneCPushStatus;
  // `У-258`: поля, по которым считается источник документа.
  bitrixId: string | null;
  externalId: string | null;
  generatedBy: string;
  uploadedBy: { role: string } | null;
};

export async function listManagerOrderLessDocuments(
  prisma: PrismaClient,
  session: SessionPayload,
  opts?: {
    type?: DocumentType;
    oneCPushStatus?: OneCPushStatus | undefined;
    take?: number;
    cursor?: string;
  }
): Promise<{ rows: ManagerOrderLessRow[]; nextCursor: string | null }> {
  if (!session.companyId) return { rows: [], nextCursor: null };
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const where: Prisma.DocumentWhereInput = {
    ...managerOrderLessWhere(session.companyId),
    ...(opts?.type ? { type: opts.type } : {}),
    ...(opts?.oneCPushStatus ? { oneCPushStatus: opts.oneCPushStatus } : {}),
  };
  const rows = await prisma.document.findMany({
    where,
    orderBy: { id: 'desc' },
    take: take + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      type: true,
      direction: true,
      signedAt: true,
      createdAt: true,
      size: true,
      counterpartyType: true,
      counterpartyId: true,
      oneCPushStatus: true,
      // `У-258`: то же, что у списка по заказам, — источник виден и здесь.
      bitrixId: true,
      externalId: true,
      generatedBy: true,
      number: true,
      version: true,
      uploadedBy: { select: { role: true } },
    },
  });
  const hasMore = rows.length > take;
  const sliced = hasMore ? rows.slice(0, take) : rows;
  return {
    rows: sliced as ManagerOrderLessRow[],
    nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
  };
}
