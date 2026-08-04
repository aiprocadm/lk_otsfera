import type { PrismaClient, Prisma } from '@prisma/client';
import { listMissingRequisites, type MissingRequisite } from '@/lib/documents/requisites-check';

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
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
} satisfies Prisma.OrganizationSelect & Prisma.CompanySelect;

export type DocumentGenerationPanel = {
  missing: MissingRequisite[];
  hasInvoice: boolean;
  hasContract: boolean;
};

export async function getDocumentGenerationPanel(
  prisma: PrismaClient,
  args: { orderId: string; companyId: string; organizationId: string }
): Promise<DocumentGenerationPanel> {
  const [company, organization, generated] = await Promise.all([
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
  ]);
  // Сторона могла исчезнуть между запросами — тогда список недостающего пуст
  // (гейт мутации всё равно вернёт not_found), панель просто рисуется.
  const missing: MissingRequisite[] =
    company && organization ? listMissingRequisites(company, organization) : [];
  const generatedTypes = new Set(generated.map((row) => row.type));
  return {
    missing,
    hasInvoice: generatedTypes.has('invoice'),
    hasContract: generatedTypes.has('contract'),
  };
}
