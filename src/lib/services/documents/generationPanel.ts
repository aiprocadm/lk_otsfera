import type { CatalogUnit, PrismaClient, Prisma } from '@prisma/client';
import {
  listMissingRequisites,
  type MissingRequisite,
  type RequisitesDocKind,
} from '@/lib/documents/requisites-check';

/**
 * Читающая половина панели генерации счёта/акта на карточке заказа
 * (этап 8, ФТ-9.4/9.5). Пишущая — `generateOrderDocument` в `./generate`;
 * сюда она не вынесена намеренно: панель не должна тянуть за собой рендер PDF
 * и объектное хранилище.
 *
 * Панель показывает две вещи: чего не хватает в реквизитах сторон (кнопка
 * неактивна + список) и какие документы по заказу уже сгенерированы системой.
 *
 * Скоуп: доступ к заказу проверяет вызывающая страница (менеджерская карточка
 * заказа читается через `loadManagerOrderDetail` → `canSeeOrder`, C8), а
 * `companyId`/`organizationId` приходят из уже проверенного заказа — поэтому
 * своей проверки прав здесь нет. Собственный гард остаётся у мутации.
 */

/** Ровно те поля реквизитов, которые проверяет `listMissingRequisites`. */
const REQUISITES_SELECT = {
  name: true,
  legalName: true,
  inn: true,
  kpp: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true,
} satisfies Prisma.OrganizationSelect & Prisma.CompanySelect;

export const DOC_KINDS: RequisitesDocKind[] = ['invoice', 'act', 'contract', 'extra_agreement'];

/** Документ-основание для выбора в форме выпуска (`У-147`). */
export type IssueBaseDocument = { id: string; type: string; number: string; date: string };

/** Строка состава для предзаполнения формы выпуска (`У-147`). */
export type IssuePrefillLine = {
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
};

export type DocumentGenerationPanel = {
  /**
   * Недостающие реквизиты **по типу документа** (`У-156`): счёт нельзя
   * выставить без банковских реквизитов, а договор — без подписанта
   * заказчика. Один общий список врал бы про оба случая сразу.
   */
  missingByType: Record<RequisitesDocKind, MissingRequisite[]>;
  hasInvoice: boolean;
  hasContract: boolean;
  /** Счета и договоры заказа — из них выбирают основание акта и ДС. */
  baseDocuments: IssueBaseDocument[];
  /** Кому выпускаем — показывается в форме и не редактируется. */
  counterpartyName: string;
  /** Состав заказа, которым форма заполняется по умолчанию. */
  orderLines: IssuePrefillLine[];
};

export async function getDocumentGenerationPanel(
  prisma: PrismaClient,
  args: { orderId: string; companyId: string; organizationId: string }
): Promise<DocumentGenerationPanel> {
  const [company, organization, generated, baseRows, lineRows] = await Promise.all([
    prisma.company.findUnique({ where: { id: args.companyId }, select: REQUISITES_SELECT }),
    prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: REQUISITES_SELECT,
    }),
    prisma.document.groupBy({
      by: ['type'],
      where: {
        orderId: args.orderId,
        type: { in: ['invoice', 'contract'] },
        generatedBy: 'system',
      },
      _count: { _all: true },
    }),
    prisma.document.findMany({
      where: {
        orderId: args.orderId,
        type: { in: ['invoice', 'contract'] },
        number: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, number: true, createdAt: true },
    }),
    prisma.orderLine.findMany({
      where: { orderId: args.orderId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        title: true,
        quantity: true,
        unit: true,
        unitPrice: true,
        discountPercent: true,
        vatRate: true,
        vatIncluded: true,
      },
    }),
  ]);
  // Сторона могла исчезнуть между запросами — тогда список недостающего пуст
  // (гейт мутации всё равно вернёт not_found), панель просто рисуется.
  const missingByType = {} as Record<RequisitesDocKind, MissingRequisite[]>;
  for (const kind of DOC_KINDS) {
    missingByType[kind] =
      company && organization ? listMissingRequisites(company, organization, kind) : [];
  }
  const generatedTypes = new Set(generated.map((row) => row.type));
  return {
    missingByType,
    hasInvoice: generatedTypes.has('invoice'),
    hasContract: generatedTypes.has('contract'),
    baseDocuments: baseRows.map((row) => ({
      id: row.id,
      type: row.type,
      // Номер не пуст по условию выборки; хвост оставлен ради типа.
      number: row.number ?? '',
      date: row.createdAt.toISOString(),
    })),
    counterpartyName: organization?.legalName?.trim() || organization?.name?.trim() || 'заказчик',
    // `Decimal` через границу server→client не проходит — отдаём строками.
    orderLines: lineRows.map((row) => ({
      title: row.title,
      quantity: row.quantity.toString(),
      unit: row.unit,
      unitPrice: row.unitPrice.toString(),
      discountPercent: row.discountPercent?.toString() ?? null,
      vatRate: row.vatRate?.toString() ?? null,
      vatIncluded: row.vatIncluded,
    })),
  };
}
