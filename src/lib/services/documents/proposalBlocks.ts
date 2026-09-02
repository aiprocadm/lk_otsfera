import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { dealScopeWhere } from '@/lib/services/deals/board';
import { proposalDisplayStatus } from '@/lib/documents/proposalExpiry';

/**
 * `У-166` (этап 7) — списки коммерческих предложений для карточек сделки и
 * организации.
 *
 * **Почему отдельный файл, а не расширение карточки организации.** Три
 * самостоятельные причины:
 *
 * 1. карточку организации рисуют ПЯТЬ кабинетов одним сервисом — включая
 *    партнёра и заказчика. Всё, что попадёт в её тип, уедет к ним в ответе
 *    сервера, даже если вкладку им не показать; а спека §3.9 прямо запрещает
 *    показывать предложения партнёру: цены и скидки — не то, что видит
 *    посредник;
 * 2. страж действующих версий инвентаризует выборки документов с точностью до
 *    ФУНКЦИИ. Второй `findMany` внутри той же функции он бы не увидел — и
 *    фильтр заменённых версий перестал бы проверяться молча;
 * 3. карточке сделки список нужен ленивым: она модалка на доске, где карточек
 *    десятки, и грузить предложения каждой при отрисовке значило бы платить
 *    за то, чего человек не открывал.
 */

export type ProposalBlockRow = {
  id: string;
  number: string | null;
  /** Уже прогнано через расчёт «истекло»: показ опережает ночную задачу. */
  status: string;
  /** `Decimal` через границу server→client не проходит — строка. */
  amountGross: string | null;
  sentAt: Date | null;
  validUntil: Date | null;
  createdAt: Date;
};

export type ProposalBlockResult =
  { ok: true; rows: ProposalBlockRow[] } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Поля, без которых блок соврёт. `type` здесь не для красоты: расчёт «истекло»
 * сам проверяет тип документа, и без этого поля истёкшее предложение
 * показалось бы «Отправлено».
 */
const SELECT = {
  id: true,
  type: true,
  number: true,
  status: true,
  amountGross: true,
  sentAt: true,
  validUntil: true,
  createdAt: true,
} as const;

function toRow(
  doc: {
    id: string;
    type: string;
    status: string;
    number: string | null;
    amountGross: { toFixed: (n: number) => string } | null;
    sentAt: Date | null;
    validUntil: Date | null;
    createdAt: Date;
  },
  now: Date
): ProposalBlockRow {
  return {
    id: doc.id,
    number: doc.number,
    status: proposalDisplayStatus(doc, now),
    amountGross: doc.amountGross ? doc.amountGross.toFixed(2) : null,
    sentAt: doc.sentAt,
    validUntil: doc.validUntil,
    createdAt: doc.createdAt,
  };
}

/** Предложения, выставленные ПО СДЕЛКЕ (`У-166`). */
export async function listDealProposals(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string },
  now?: Date
): Promise<ProposalBlockResult> {
  if (session.role !== 'admin' && !isStaffManagerSide(session))
    return { ok: false, error: 'forbidden' };

  // Сделку сверяем скоупом сотрудника — тем же, что у заметок и доски: иначе
  // блок отдал бы чужие переговоры по одному лишь идентификатору.
  const deal = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: { id: true },
  });
  if (!deal) return { ok: false, error: 'not_found' };

  const rows = await prisma.document.findMany({
    // Заменённые перевыпуском версии скрыты: у них тот же номер, и две строки
    // подряд читались бы как два разных предложения.
    where: { dealId: deal.id, type: 'commercial_proposal', supersededAt: null },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  });
  return { ok: true, rows: rows.map((r) => toRow(r, now ?? new Date())) };
}

/** Предложения, выставленные ОРГАНИЗАЦИИ (`У-166`). */
export async function listOrganizationProposals(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string },
  now?: Date
): Promise<ProposalBlockResult> {
  if (session.role !== 'admin' && !isStaffManagerSide(session))
    return { ok: false, error: 'forbidden' };

  const rows = await prisma.document.findMany({
    where: {
      counterpartyType: 'organization',
      counterpartyId: args.organizationId,
      type: 'commercial_proposal',
      supersededAt: null,
      /**
       * Граница компании берётся у ДОКУМЕНТА, а не у организации: у документа
       * это поле обязательное, а у организации — нет. Администратор видит всё
       * (у него компании в сессии может не быть вовсе).
       */
      ...(session.role === 'admin' ? {} : { companyId: session.companyId ?? '' }),
    },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  });
  return { ok: true, rows: rows.map((r) => toRow(r, now ?? new Date())) };
}
