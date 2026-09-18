import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { CUSTOM_FIELD_ROLE_LABELS, isCustomFieldRole } from '@/lib/services/customFields/roles';
import { getVersionChain, type VersionRow } from './versions';

/**
 * История документа для карточки СОТРУДНИКА: цепочка версий (`У-251`) и
 * «Кто скачивал» (`У-254`).
 *
 * Оба блока — внутренний контур. Заказчику и партнёру они не показываются:
 * список читателей чужой бумаги — это сведения о работе исполнителя, а не о
 * самом документе. Поэтому история живёт отдельным сервисом, а не в
 * `getDocumentDetail`, который зовут все пять кабинетов: положи её туда — и
 * однажды она уедет в клиентский кабинет вместе с полем.
 *
 * Скоуп проверяется ТОЙ ЖЕ функцией `canReadDocument`, что у карточки и у
 * скачивания (§4, defense-in-depth). Страница уже позвала гард роли, но кнопка
 * и гард страницы правами не являются.
 */

export type DownloadRow = {
  id: string;
  at: Date;
  /** Кто скачал; `null` — пользователь удалён. */
  userName: string | null;
  /** Роль читателя по-русски; если роль незнакомая — её код. */
  roleLabel: string;
  /** Какую версию унесли; `null` — скачивание старше этапа 8. */
  version: number | null;
};

export type DocumentHistory = {
  /** Пусто, если версия одна: блок «История версий» тогда не рисуется. */
  versions: VersionRow[];
  /** Последние 20 (`В-8-2`); дальше — по ссылке в журнал аудита. */
  downloads: DownloadRow[];
  /**
   * `У-169`: версия, которая уже уехала в 1С вместо текущей. `null` — либо
   * этот документ первый, либо прежний в 1С не отправляли.
   */
  pushedVersionInOneC: number | null;
};

export type DocumentHistoryResult =
  { ok: true; history: DocumentHistory } | { ok: false; error: 'not_found' | 'forbidden' };

/** Сотрудник исполнителя: менеджерский контур плюс администратор (Model A). */
function isStaff(session: SessionPayload): boolean {
  return isStaffManagerSide(session) || session.role === 'admin';
}

/** Последние скачивания документа — из того же события, что пишут три роута. */
const DOWNLOADS_LIMIT = 20;

function roleLabel(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—';
  return isCustomFieldRole(value) ? CUSTOM_FIELD_ROLE_LABELS[value] : value;
}

function versionFromMeta(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function getDocumentHistory(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<DocumentHistoryResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      type: true,
      status: true,
      direction: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      orderId: true,
      number: true,
      createdAt: true,
      generatedBy: true,
      replacesDocumentId: true,
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  // Отказ и отсутствие неотличимы снаружи — как в карточке: иначе по коду
  // ответа перебором узнаётся, какие документы существуют.
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };

  const [chain, events, previous] = await Promise.all([
    getVersionChain(prisma, documentId),
    prisma.auditLog.findMany({
      where: { entity: 'document', entityId: documentId, action: 'document_download_signed_url' },
      orderBy: { createdAt: 'desc' },
      take: DOWNLOADS_LIMIT,
      select: {
        id: true,
        createdAt: true,
        meta: true,
        user: { select: { name: true, email: true } },
      },
    }),
    doc.replacesDocumentId
      ? prisma.document.findUnique({
          where: { id: doc.replacesDocumentId },
          select: { version: true, oneCPushStatus: true },
        })
      : null,
  ]);

  const downloads: DownloadRow[] = events.map((e) => {
    // `meta` — свободный JSON: у записей до этапа 8 внутри нет ни роли, ни
    // версии. Читаем осторожно, а не приводим типом — иначе старая строка
    // журнала уронит карточку.
    const after =
      e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta)
        ? (e.meta as Record<string, unknown>).after
        : null;
    const bag = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
    const record = bag as Record<string, unknown>;
    return {
      id: e.id,
      at: e.createdAt,
      userName: e.user ? e.user.name || e.user.email : null,
      roleLabel: roleLabel(record.viewer),
      version: versionFromMeta(record.version),
    };
  });

  return {
    ok: true,
    history: {
      // Одна версия — не история. Показывать блок с единственной строкой значит
      // занимать место рассказом о том, что и так написано в шапке карточки.
      versions: chain.length > 1 ? chain : [],
      downloads,
      pushedVersionInOneC:
        previous && previous.oneCPushStatus === 'pushed' ? previous.version : null,
    },
  };
}
