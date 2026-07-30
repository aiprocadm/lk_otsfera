import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listMissingRequisites, type MissingRequisite } from '@/lib/documents/requisites-check';
import { renderOrderDocumentPdf, type OrderDocumentData, type PartyBlock } from './orderDocumentPdf';
import { renderContractDocumentPdf, type ContractDocumentData } from './contractDocumentPdf';
import { getObjectStorage } from '@/lib/storage';
import { notifyOrgUsers } from '@/lib/notifications';
import { log } from '@/lib/logging';

/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — генерация счёта/акта по заказу в 1 клик.
 * Гейты: staff (manager|admin) + canSeeOrder (C8 teamMode-aware). Полнота
 * реквизитов — до всего (список недостающего в ошибке). Номер: счёт —
 * атомарный upsert+increment `DocumentCounter(companyId, year)` в транзакции
 * («С-{год}-{N}», конкурентно-безопасно); акт наследует номер последнего
 * счёта заказа («А-{год}-{N}»; без счёта — validation). Повторная генерация —
 * новый Document `version+1` + `replacesDocumentId`. Файл генерируем сами →
 * `scanStatus='clean'` (антивирус для собственных байтов бессмыслен),
 * `generatedBy='system'`, `direction='outgoing'`. Уведомление клиенту —
 * существующее `document_published`, best-effort. Рендер синхронный (ФТ-9.6,
 * замер < 2 с закреплён unit-тестом).
 */

export type GenerateDocType = 'invoice' | 'act' | 'contract' | 'extra_agreement';

export type GenerateResult =
  | { ok: true; documentId: string; number: string }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'missing_requisites'
        | 'invoice_required'
        | 'contract_required'
        | 'no_organization'
        | 'storage';
      missing?: MissingRequisite[];
    };

/** Ведущий документ пары (номер наследуется) — решение заказчика по акту, зеркально для ДС. */
const LEADER_OF: Record<GenerateDocType, 'invoice' | 'contract' | null> = {
  invoice: null,
  act: 'invoice',
  contract: null,
  extra_agreement: 'contract'
};
const NUMBER_PREFIX: Record<GenerateDocType, string> = {
  invoice: 'С',
  act: 'А',
  contract: 'Д',
  extra_agreement: 'ДС'
};
/** Последовательность номеров: счёт и договор нумеруются независимо. */
const COUNTER_KIND: Record<GenerateDocType, string> = {
  invoice: 'invoice',
  act: 'invoice',
  contract: 'contract',
  extra_agreement: 'contract'
};

const fmtMoney = (v: unknown): string =>
  Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function party(row: {
  name?: string | null;
  legalName: string | null;
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
  signerBasis: string | null;
  phone?: string | null;
  email?: string | null;
}): PartyBlock {
  return {
    // Причина ignore: хвост `|| ''` недостижим — listMissingRequisites выше
    // требует юр. название исполнителя и (юр. или рабочее) название заказчика,
    // поэтому к моменту сборки блока имя всегда есть. Хвост оставлен ради типа.
    /* v8 ignore next */
    displayName: row.legalName?.trim() || row.name?.trim() || '',
    inn: row.inn,
    kpp: row.kpp,
    legalAddress: row.legalAddress,
    bankName: row.bankName,
    bankAccount: row.bankAccount,
    corrAccount: row.corrAccount,
    bic: row.bic,
    signerName: row.signerName,
    signerPosition: row.signerPosition,
    signerBasis: row.signerBasis,
    phone: row.phone ?? null,
    email: row.email ?? null
  };
}

const PARTY_SELECT = {
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
  signerBasis: true
} as const;

export async function generateOrderDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; docType: GenerateDocType; now?: Date }
): Promise<GenerateResult> {
  if (session.role !== 'manager' && session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      title: true,
      orderNumber: true,
      companyId: true,
      organizationId: true,
      managerId: true,
      totalAmount: true,
      vatIncluded: true,
      vatRate: true,
      items: {
        select: { amount: true, note: true, direction: { select: { name: true } }, student: { select: { name: true } } }
      }
    }
  });
  if (!order) return { ok: false, error: 'not_found' };

  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const visible = canSeeOrder(
      session,
      { managerId: order.managerId, organizationId: order.organizationId, companyId: order.companyId },
      teamMode
    );
    if (!visible) return { ok: false, error: 'not_found' };
  }
  if (!order.organizationId) return { ok: false, error: 'no_organization' };
  if (!order.companyId) return { ok: false, error: 'missing_requisites', missing: [{ side: 'company', label: 'компания-исполнитель заказа' }] };

  const [company, organization] = await Promise.all([
    prisma.company.findUnique({ where: { id: order.companyId }, select: { ...PARTY_SELECT, phone: true, email: true } }),
    prisma.organization.findUnique({ where: { id: order.organizationId }, select: PARTY_SELECT })
  ]);
  if (!company || !organization) return { ok: false, error: 'not_found' };

  const missing = listMissingRequisites(company, organization);
  if (missing.length > 0) return { ok: false, error: 'missing_requisites', missing };

  const now = args.now ?? new Date();
  const year = now.getFullYear();

  // Позиции: попозиционно при заполненных amount, иначе одна строка на сумму заказа (§9-3).
  const priced = order.items.filter((i) => i.amount != null);
  const items =
    priced.length > 0
      ? priced.map((i) => ({
          name: [i.direction?.name, i.student?.name].filter(Boolean).join(' — ') || i.note || 'Услуга',
          amount: fmtMoney(i.amount)
        }))
      : [{ name: `Услуги по заказу ${order.orderNumber ? `№${order.orderNumber}` : ''}: ${order.title}`.trim(), amount: fmtMoney(order.totalAmount) }];
  const total = fmtMoney(
    priced.length > 0 ? priced.reduce((sum, i) => sum + Number(i.amount), 0) : Number(order.totalAmount)
  );
  const vatLine = order.vatIncluded
    ? `В том числе НДС${order.vatRate ? ` ${(Number(order.vatRate) * 100).toFixed(0)}%` : ''}.`
    : 'НДС не облагается.';

  // Номер + строка Document — в одной транзакции (конкурентная безопасность счётчика).
  let created: { id: string; number: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      // Ведущие документы (счёт, договор) берут номер из своей последовательности;
      // ведомые (акт, доп. соглашение) наследуют номер ведущего по заказу.
      const leader = LEADER_OF[args.docType];
      let numeric: number;
      let baseDoc: { number: string; createdAt: Date } | null = null;
      if (leader === null) {
        const counter = await tx.documentCounter.upsert({
          where: { companyId_year_kind: { companyId: order.companyId!, year, kind: COUNTER_KIND[args.docType] } },
          create: { companyId: order.companyId!, year, kind: COUNTER_KIND[args.docType], lastNumber: 1 },
          update: { lastNumber: { increment: 1 } }
        });
        numeric = counter.lastNumber;
      } else {
        const found = await tx.document.findFirst({
          where: { orderId: order.id, type: leader, generatedBy: 'system', number: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { number: true, createdAt: true }
        });
        const parsed = found?.number?.match(/(\d+)$/);
        if (!parsed) throw new LeaderRequiredError(leader);
        numeric = Number(parsed[1]);
        baseDoc = { number: found!.number!, createdAt: found!.createdAt };
      }
      const number = `${NUMBER_PREFIX[args.docType]}-${year}-${numeric}`;

      const previous = await tx.document.findFirst({
        where: { orderId: order.id, type: args.docType, generatedBy: 'system' },
        orderBy: { version: 'desc' },
        select: { id: true, version: true }
      });

      const isContractKind = args.docType === 'contract' || args.docType === 'extra_agreement';
      let buffer: Buffer;
      if (isContractKind) {
        const contractData: ContractDocumentData = {
          docType: args.docType as 'contract' | 'extra_agreement',
          number,
          date: now,
          company: party(company),
          organization: party(organization),
          subject: order.title,
          items,
          total,
          vatLine,
          baseContract: baseDoc ? { number: baseDoc.number, date: baseDoc.createdAt } : null
        };
        buffer = await renderContractDocumentPdf(contractData);
      } else {
        const data: OrderDocumentData = {
          docType: args.docType as 'invoice' | 'act',
          number,
          date: now,
          company: party(company),
          organization: party(organization),
          orderLabel: `Заказ ${order.orderNumber ? `№${order.orderNumber} ` : ''}«${order.title}»`,
          items,
          total,
          vatLine
        };
        buffer = await renderOrderDocumentPdf(data);
      }

      const fileName = `${number}.pdf`;
      const path = `orders/${order.id}/generated/${args.docType}-v${(previous?.version ?? 0) + 1}-${number}.pdf`;
      await getObjectStorage().upload(path, buffer, { contentType: 'application/pdf' });

      const doc = await tx.document.create({
        data: {
          name: fileName,
          path,
          mimeType: 'application/pdf',
          size: buffer.length,
          type: args.docType,
          direction: 'outgoing',
          number,
          version: (previous?.version ?? 0) + 1,
          replacesDocumentId: previous?.id ?? null,
          generatedBy: 'system',
          orderId: order.id,
          counterpartyType: 'organization',
          counterpartyId: order.organizationId!,
          uploadedById: session.sub,
          scanStatus: 'clean',
          scannedAt: now
        } as Prisma.DocumentUncheckedCreateInput
      });

      await recordAudit(tx, {
        userId: session.sub,
        action: 'document_generated',
        entity: 'document',
        entityId: doc.id,
        after: { orderId: order.id, docType: args.docType, number, version: doc.version }
      });

      return { id: doc.id, number };
    });
  } catch (e) {
    if (e instanceof LeaderRequiredError) {
      return { ok: false, error: e.leader === 'invoice' ? 'invoice_required' : 'contract_required' };
    }
    if (e instanceof Error && e.name === 'StorageError') return { ok: false, error: 'storage' };
    throw e;
  }

  // Уведомление клиенту — best-effort (не откатывает генерацию).
  try {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'document_published',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        documentName: `${created.number}.pdf`,
        documentType: args.docType
      }
    });
  } catch (err) {
    log.warn('[documents/generate] notify failed', { orderId: order.id, error: (err as Error).message });
  }

  return { ok: true, documentId: created.id, number: created.number };
}

/** Ведомый документ (акт/допсоглашение) не может быть создан без ведущего. */
class LeaderRequiredError extends Error {
  constructor(readonly leader: 'invoice' | 'contract') {
    super(`${leader}_required`);
    this.name = 'LeaderRequiredError';
  }
}
