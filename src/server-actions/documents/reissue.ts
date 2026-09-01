'use server';

import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { canReadDocument } from '@/lib/auth/policy';
import {
  getDocumentGenerationPanel,
  getOrgDocumentIssuePanel,
  type ReissuePanel,
} from '@/lib/services/documents/generationPanel';

/**
 * Этап 6 (`У-151`) — данные формы перевыпуска, по клику.
 *
 * Гейт свой и полный: флаг генерации, роль сотрудника ЦО и тот же предикат
 * доступа к документу, что у скачивания (§4). Кнопка на карточке — внешний
 * вид, а не запрет.
 */
export type ReissuePanelResult =
  | { ok: true; panel: ReissuePanel }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_reissuable' };

export async function reissuePanelAction(fd: FormData): Promise<ReissuePanelResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };

  const documentId =
    typeof fd.get('documentId') === 'string' ? (fd.get('documentId') as string) : '';
  if (!documentId) return { ok: false, error: 'not_found' };

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      type: true,
      // `У-164`: гейту чтения нужно состояние — черновик КП клиенту не
      // показывается. Без поля гейт сходил бы в базу второй раз, а страж
      // `security.document-read-fields.guardrail` этого не допустит.
      status: true,
      number: true,
      supersededAt: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { companyId: true, organizationId: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          discountPercent: true,
          vatRate: true,
        },
      },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };

  // Перевыпускается только выпущенная нами бумага с номером и только та, что
  // ещё действует: заменённую версию заменяют не второй раз, а её преемницу.
  const reissuable = ['invoice', 'act', 'contract', 'extra_agreement'];
  if (!doc.number || doc.supersededAt || !reissuable.includes(doc.type))
    return { ok: false, error: 'not_reissuable' };

  const lines = doc.lines.map((l) => ({
    title: l.title,
    quantity: l.quantity.toString(),
    unit: l.unit,
    unitPrice: l.unitPrice.toString(),
    discountPercent: l.discountPercent?.toString() ?? null,
    vatRate: l.vatRate?.toString() ?? null,
    // Снимок строки хранит уже посчитанные суммы, поэтому цена в нём —
    // «как было», и признак «цена с НДС» повторно не применяется.
    vatIncluded: false,
  }));

  if (doc.orderId) {
    // Заказ есть, но у него нет компании или организации — перевыпускать не на
    // кого. Молча уйти в ветку «документ без заказа» значило бы потерять
    // привязку документа к заказу.
    if (!doc.order?.companyId || !doc.order.organizationId)
      return { ok: false, error: 'not_reissuable' };
    const panel = await getDocumentGenerationPanel(prisma, {
      orderId: doc.orderId,
      companyId: doc.order.companyId,
      organizationId: doc.order.organizationId,
    });
    return {
      ok: true,
      panel: {
        docType: doc.type,
        target: { kind: 'order', orderId: doc.orderId },
        counterpartyName: panel.counterpartyName,
        missingByType: panel.missingByType,
        baseDocuments: panel.baseDocuments,
        hasInvoice: panel.hasInvoice,
        hasContract: panel.hasContract,
        lines: lines.length > 0 ? lines : panel.orderLines,
        catalog: [],
      },
    };
  }

  if (doc.companyId && doc.counterpartyType === 'organization' && doc.counterpartyId) {
    const panel = await getOrgDocumentIssuePanel(prisma, {
      organizationId: doc.counterpartyId,
      companyId: doc.companyId,
    });
    return {
      ok: true,
      panel: {
        docType: doc.type,
        target: { kind: 'organization', organizationId: doc.counterpartyId },
        counterpartyName: panel.counterpartyName,
        missingByType: panel.missingByType,
        baseDocuments: panel.baseDocuments,
        hasInvoice: false,
        hasContract: panel.hasContract,
        lines,
        catalog: panel.catalog,
      },
    };
  }

  // Загруженный вручную файл и документ 1С перевыпускать нечем: у них нет ни
  // заказа с компанией, ни организации-владельца в нашем понимании.
  return { ok: false, error: 'not_reissuable' };
}
