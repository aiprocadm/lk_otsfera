import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listMissingRequisites, type MissingRequisite } from '@/lib/documents/requisites-check';
import { getObjectStorage } from '@/lib/storage';
import { notifyOrgUsers } from '@/lib/notifications';
import { log } from '@/lib/logging';
import { computeLineTotals } from '@/lib/services/orders/lineMath';
import { renderContractDocumentPdf, type ContractDocumentData } from './contractDocumentPdf';
import {
  renderOrderDocumentPdf,
  type OrderDocumentData,
  type PartyBlock,
} from './orderDocumentPdf';
import { buildPrintTable, fallbackPrintLine, type PrintLineInput } from './printTable';
import { loadDocumentBranding } from './branding';

/**
 * Выпуск счёта, акта, договора и доп. соглашения по заказу.
 *
 * Гейты: staff (manager|leader|admin) + `canSeeOrder` (C8 teamMode-aware).
 * Полнота реквизитов — до всего, и **набор зависит от типа** (`У-156`).
 * Номер: ведущий тип берёт его атомарным upsert+increment
 * `DocumentCounter(companyId, year, kind)`, ведомый (акт, ДС) наследует номер
 * документа-основания. Повторный выпуск — новый `Document` с `version+1` и
 * `replacesDocumentId`. Файл генерируем сами → `scanStatus='clean'`
 * (антивирус для собственных байтов бессмыслен), `generatedBy='system'`,
 * `direction='outgoing'`.
 *
 * **Порядок шагов (`У-152`, дефекты `Д-1`, `Д-2`)** — три отдельных шага
 * вместо одной длинной транзакции:
 *
 * 1. короткая транзакция резервирует номер и версию;
 * 2. **вне транзакции** рендерится PDF и грузится в хранилище (ключ с UUID —
 *    повтор не перезаписывает прежний файл);
 * 3. короткая транзакция пишет `Document`, его строки-снимок и аудит; если
 *    она упала, загруженный объект удаляется компенсирующим шагом.
 *
 * Раньше всё это жило в одной транзакции: она держала строку счётчика
 * номеров на время рендера и загрузки в хранилище, а откат оставлял
 * файл-сироту.
 */

export type GenerateDocType = 'invoice' | 'act' | 'contract' | 'extra_agreement';

/** Что делать, когда сумма строк разошлась с суммой заказа (`У-143`). */
export type AmountMismatchChoice = 'update_order' | 'keep_order';

/** Поля формы выпуска (`У-147`), влияющие на печать. */
export type IssueExtras = {
  /** Дата документа; по умолчанию — сегодня. */
  documentDate?: Date;
  /** Договор: предмет (по умолчанию — название заказа). */
  subject?: string;
  /** Договор: срок действия и порядок оплаты. */
  validUntil?: Date;
  paymentTerms?: string;
  /** Доп. соглашение: текст изменения. */
  changeText?: string;
  /** Акт: период оказания услуг. */
  periodFrom?: Date;
  periodTo?: Date;
  /**
   * Документ-основание выбором (`У-147`): акту — счёт, ДС — договор.
   * Без него берётся последний по типу — прежнее поведение.
   */
  parentDocumentId?: string;
};

export type GenerateArgs = {
  orderId: string;
  docType: GenerateDocType;
  now?: Date;
  /**
   * Номер и дата документа-основания — их знает только шаг резервирования
   * номера, поэтому в шаблон они попадают отдельным полем.
   */
  baseContract?: { number: string; date: Date } | null;
  /** Строки из формы выпуска; не передали — берём состав заказа. */
  lines?: PrintLineInput[];
  /** Ответ на вопрос о расхождении сумм (`У-143`). */
  onAmountMismatch?: AmountMismatchChoice;
  extras?: IssueExtras;
};

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
        | 'parent_not_found'
        | 'storage';
      missing?: MissingRequisite[];
    }
  | {
      /** `У-143`: спрашиваем человека, а не выбираем цифру за него. */
      ok: false;
      error: 'amount_mismatch';
      linesTotal: string;
      orderTotal: string;
    };

/** Ведущий документ пары (номер наследуется) — решение заказчика по акту, зеркально для ДС. */
const LEADER_OF: Record<GenerateDocType, 'invoice' | 'contract' | null> = {
  invoice: null,
  act: 'invoice',
  contract: null,
  extra_agreement: 'contract',
};
const NUMBER_PREFIX: Record<GenerateDocType, string> = {
  invoice: 'С',
  act: 'А',
  contract: 'Д',
  extra_agreement: 'ДС',
};
/** Последовательность номеров: счёт и договор нумеруются независимо. */
const COUNTER_KIND: Record<GenerateDocType, string> = {
  invoice: 'invoice',
  act: 'invoice',
  contract: 'contract',
  extra_agreement: 'contract',
};

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
    email: row.email ?? null,
  };
}

const PARTY_SELECT = {
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
} as const;

/** Ошибки, общие для выпуска и предпросмотра. */
type IssueFailure = Extract<GenerateResult, { ok: false; error: string }>;

type IssueContext = {
  order: {
    id: string;
    title: string;
    orderNumber: string | null;
    organizationId: string;
  };
  companyId: string;
  company: PartyBlock;
  organization: PartyBlock;
  printLines: PrintLineInput[];
  table: ReturnType<typeof buildPrintTable>;
  branding: Awaited<ReturnType<typeof loadDocumentBranding>>;
  /** Сумма заказа строкой фиксированной точности — для сверки (`У-143`). */
  orderTotal: string;
  documentDate: Date;
};

/**
 * Общая половина выпуска и предпросмотра (`У-147`): гейты, реквизиты, строки,
 * итоги и оформление. Номер здесь НЕ резервируется — предпросмотр не должен
 * тратить номера из счётчика, иначе в нумерации появлялись бы дыры от каждой
 * «посмотреть, как получится».
 */
async function loadIssueContext(
  prisma: PrismaClient,
  session: SessionPayload,
  args: GenerateArgs
): Promise<{ ok: true; ctx: IssueContext } | IssueFailure> {
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };

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
      // `У-139` (этап 5): табличную часть печатают ФИНАНСОВЫЕ строки заказа.
      lines: {
        select: {
          title: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          discountPercent: true,
          vatRate: true,
          vatIncluded: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!order) return { ok: false, error: 'not_found' };

  if (isStaffManagerSide(session)) {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const visible = canSeeOrder(
      session,
      {
        managerId: order.managerId,
        organizationId: order.organizationId,
        companyId: order.companyId,
      },
      teamMode
    );
    if (!visible) return { ok: false, error: 'not_found' };
  }
  if (!order.organizationId) return { ok: false, error: 'no_organization' };
  const companyId = order.companyId;
  if (!companyId)
    return {
      ok: false,
      error: 'missing_requisites',
      missing: [{ side: 'company', label: 'компания-исполнитель заказа' }],
    };

  const [company, organization] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      // Ставка НДС по умолчанию нужна заказу без состава (`У-142`).
      select: { ...PARTY_SELECT, phone: true, email: true, defaultVatRate: true },
    }),
    prisma.organization.findUnique({ where: { id: order.organizationId }, select: PARTY_SELECT }),
  ]);
  if (!company || !organization) return { ok: false, error: 'not_found' };

  // `У-156`: набор обязательных реквизитов зависит от типа документа.
  const missing = listMissingRequisites(company, organization, args.docType);
  if (missing.length > 0) return { ok: false, error: 'missing_requisites', missing };

  const documentDate = args.extras?.documentDate ?? args.now ?? new Date();

  // Табличная часть (`У-141`, `У-142`): строки из формы выпуска, иначе состав
  // заказа, иначе одна строка-заглушка на сумму заказа.
  const printLines: PrintLineInput[] =
    args.lines && args.lines.length > 0
      ? args.lines
      : order.lines.length > 0
        ? order.lines.map((l) => ({
            title: l.title,
            quantity: l.quantity.toString(),
            unit: l.unit,
            unitPrice: l.unitPrice.toString(),
            discountPercent: l.discountPercent?.toString() ?? null,
            vatRate: l.vatRate?.toString() ?? null,
            vatIncluded: l.vatIncluded,
          }))
        : [
            fallbackPrintLine({
              orderNumber: order.orderNumber,
              title: order.title,
              totalAmount: order.totalAmount.toString(),
              // Своя ставка заказа важнее умолчания компании: заказ мог быть
              // заведён по другой ставке, и подменить её умолчанием — значит
              // выставить клиенту не тот налог.
              vatRate: order.vatRate?.toString() ?? company.defaultVatRate?.toString() ?? null,
              vatIncluded: order.vatIncluded,
            }),
          ];
  const table = buildPrintTable(printLines);

  // Оформление (`У-153`) читаем ДО транзакции: картинки не зависят от номера,
  // а держать транзакцию на время скачивания из хранилища незачем.
  const branding = await loadDocumentBranding(prisma, companyId);

  return {
    ok: true,
    ctx: {
      order: {
        id: order.id,
        title: order.title,
        orderNumber: order.orderNumber,
        organizationId: order.organizationId,
      },
      companyId,
      company: party(company),
      organization: party(organization),
      printLines,
      table,
      branding,
      orderTotal: order.totalAmount.toFixed(2),
      documentDate,
    },
  };
}

/** Собрать данные шаблона: одинаково для выпуска и для предпросмотра. */
function renderDocument(
  ctx: IssueContext,
  args: GenerateArgs,
  number: string,
  draftNote: string | null
): Promise<Buffer> {
  if (args.docType === 'contract' || args.docType === 'extra_agreement') {
    const contractData: ContractDocumentData = {
      docType: args.docType,
      number,
      date: ctx.documentDate,
      company: ctx.company,
      organization: ctx.organization,
      subject: args.extras?.subject?.trim() || ctx.order.title,
      table: ctx.table,
      branding: ctx.branding,
      baseContract: args.baseContract ?? null,
      validUntil: args.extras?.validUntil ?? null,
      paymentTerms: args.extras?.paymentTerms?.trim() || null,
      changeText: args.extras?.changeText?.trim() || null,
      draftNote,
    };
    return renderContractDocumentPdf(contractData);
  }
  const data: OrderDocumentData = {
    docType: args.docType,
    number,
    date: ctx.documentDate,
    company: ctx.company,
    organization: ctx.organization,
    orderLabel: `Заказ ${ctx.order.orderNumber ? `№${ctx.order.orderNumber} ` : ''}«${ctx.order.title}»`,
    table: ctx.table,
    branding: ctx.branding,
    servicePeriod:
      args.extras?.periodFrom && args.extras.periodTo
        ? { from: args.extras.periodFrom, to: args.extras.periodTo }
        : null,
    draftNote,
  };
  return renderOrderDocumentPdf(data);
}

/**
 * Предпросмотр PDF до выпуска (`У-147`): те же данные и тот же шаблон, но без
 * номера, без записи в базу и без файла в хранилище. Человек видит ровно то,
 * что уйдёт клиенту, и может передумать.
 */
export async function previewOrderDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: GenerateArgs
): Promise<{ ok: true; buffer: Buffer } | IssueFailure> {
  const loaded = await loadIssueContext(prisma, session, args);
  if (!loaded.ok) return loaded;
  const buffer = await renderDocument(
    loaded.ctx,
    args,
    '—',
    'ПРЕДПРОСМОТР. Номер будет присвоен при выпуске.'
  );
  return { ok: true, buffer };
}

export async function generateOrderDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: GenerateArgs
): Promise<GenerateResult> {
  const loaded = await loadIssueContext(prisma, session, args);
  if (!loaded.ok) return loaded;
  const { ctx } = loaded;
  const { order, companyId, table, printLines } = ctx;
  const now = args.now ?? new Date();
  const year = ctx.documentDate.getFullYear();

  // `У-143` (дефект `Д-8`): расхождение суммы строк с суммой заказа — вопрос
  // человеку, а не молчаливый выбор одной из двух цифр.
  const isMoneyDocument = args.docType === 'invoice' || args.docType === 'act';
  if (isMoneyDocument && table.gross !== ctx.orderTotal) {
    if (!args.onAmountMismatch) {
      return {
        ok: false,
        error: 'amount_mismatch',
        linesTotal: table.gross,
        orderTotal: ctx.orderTotal,
      };
    }
    if (args.onAmountMismatch === 'update_order') {
      await prisma.order.update({
        where: { id: order.id },
        data: { totalAmount: table.gross, totalAmountIsManual: false },
      });
      await recordAudit(prisma, {
        userId: session.sub,
        action: 'order_total_synced',
        entity: 'order',
        entityId: order.id,
        after: { before: ctx.orderTotal, after: table.gross, reason: 'document_issue' },
      });
    }
  }

  // --- Шаг 1: короткая транзакция — номер и версия (`У-152`) -----------------
  let reserved: {
    number: string;
    version: number;
    previousId: string | null;
    parentId: string | null;
    baseDoc: { number: string; date: Date } | null;
  };
  try {
    reserved = await prisma.$transaction(async (tx) => {
      const leader = LEADER_OF[args.docType];
      let numeric: number;
      let baseDoc: { number: string; date: Date } | null = null;
      let parentId: string | null = null;
      if (leader === null) {
        const counter = await tx.documentCounter.upsert({
          where: { companyId_year_kind: { companyId, year, kind: COUNTER_KIND[args.docType] } },
          create: { companyId, year, kind: COUNTER_KIND[args.docType], lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        numeric = counter.lastNumber;
      } else {
        // `У-147`: основание выбирается в форме. Без выбора — последний по
        // типу, как раньше: «последний» был единственным вариантом и молча
        // привязывал акт не к тому счёту, если счетов у заказа несколько.
        const found = args.extras?.parentDocumentId
          ? await tx.document.findFirst({
              where: {
                id: args.extras.parentDocumentId,
                orderId: order.id,
                type: leader,
                number: { not: null },
              },
              select: { id: true, number: true, createdAt: true },
            })
          : await tx.document.findFirst({
              where: {
                orderId: order.id,
                type: leader,
                generatedBy: 'system',
                number: { not: null },
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true, number: true, createdAt: true },
            });
        if (!found) {
          throw args.extras?.parentDocumentId
            ? new ParentNotFoundError()
            : new LeaderRequiredError(leader);
        }
        const parsed = found.number?.match(/(\d+)$/);
        if (!parsed) throw new LeaderRequiredError(leader);
        numeric = Number(parsed[1]);
        // `У-151`: связь «акт → счёт», «ДС → договор» — явным полем, а не
        // догадкой «последний по типу» при каждом чтении.
        parentId = found.id;
        baseDoc = { number: found.number ?? '', date: found.createdAt };
      }

      const previous = await tx.document.findFirst({
        where: { orderId: order.id, type: args.docType, generatedBy: 'system' },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
      return {
        number: `${NUMBER_PREFIX[args.docType]}-${year}-${numeric}`,
        version: (previous?.version ?? 0) + 1,
        previousId: previous?.id ?? null,
        parentId,
        baseDoc,
      };
    });
  } catch (e) {
    if (e instanceof ParentNotFoundError) return { ok: false, error: 'parent_not_found' };
    if (e instanceof LeaderRequiredError) {
      return { ok: false, error: e.leader === 'invoice' ? 'invoice_required' : 'contract_required' };
    }
    throw e;
  }

  // --- Шаг 2: рендер и загрузка ВНЕ транзакции (`У-152`) ---------------------
  const buffer = await renderDocument(
    ctx,
    { ...args, baseContract: reserved.baseDoc },
    reserved.number,
    null
  );

  // Ключ с UUID (`Д-2`): повторный выпуск не перезаписывает прежний файл, а
  // сбойная попытка не оставляет за собой «занятое» имя.
  const path = `orders/${order.id}/generated/${args.docType}-v${reserved.version}-${randomUUID()}.pdf`;
  try {
    await getObjectStorage().upload(path, buffer, { contentType: 'application/pdf' });
  } catch (e) {
    log.error('[documents/generate] upload failed', {
      orderId: order.id,
      docType: args.docType,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'storage' };
  }

  // --- Шаг 3: короткая транзакция — документ, его строки и аудит -------------
  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          name: `${reserved.number}.pdf`,
          path,
          mimeType: 'application/pdf',
          size: buffer.length,
          type: args.docType,
          direction: 'outgoing',
          number: reserved.number,
          version: reserved.version,
          replacesDocumentId: reserved.previousId,
          parentDocumentId: reserved.parentId,
          status: 'issued',
          amountNet: table.subtotal,
          amountVat: table.vat,
          amountGross: table.gross,
          currency: 'RUB',
          generatedBy: 'system',
          orderId: order.id,
          counterpartyType: 'organization',
          counterpartyId: order.organizationId,
          uploadedById: session.sub,
          scanStatus: 'clean',
          scannedAt: now,
          // `У-146`: строки — снимок состава на момент выпуска. Правка заказа
          // задним числом выставленный документ не меняет.
          lines: { create: snapshotLines(printLines) },
        } as Prisma.DocumentUncheckedCreateInput,
        select: { id: true },
      });

      await recordAudit(tx, {
        userId: session.sub,
        action: 'document_generated',
        entity: 'document',
        entityId: doc.id,
        after: {
          orderId: order.id,
          docType: args.docType,
          number: reserved.number,
          version: reserved.version,
          amountGross: table.gross,
        },
      });
      return { id: doc.id };
    });
  } catch (e) {
    // Компенсирующее удаление (`У-152`, дефект `Д-2`): документа нет — файлу в
    // хранилище делать нечего. Сбой уборки не превращаем в ошибку выпуска.
    try {
      await getObjectStorage().remove([path]);
    } catch (removeError) {
      log.warn('[documents/generate] orphan object left in storage', {
        path,
        error: removeError instanceof Error ? removeError.message : String(removeError),
      });
    }
    throw e;
  }

  // Уведомление клиенту — best-effort (не откатывает выпуск).
  try {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'document_published',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        documentName: `${reserved.number}.pdf`,
        documentType: args.docType,
      },
    });
  } catch (err) {
    log.warn('[documents/generate] notify failed', {
      orderId: order.id,
      error: (err as Error).message,
    });
  }

  return { ok: true, documentId: created.id, number: reserved.number };
}

/** Строки документа-снимка (`У-146`) — из тех же данных, что и печать. */
function snapshotLines(lines: PrintLineInput[]) {
  return lines.map((line, index) => {
    const totals = computeLineTotals(line);
    return {
      title: line.title,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      vatRate: line.vatRate,
      vatAmount: totals.vat,
      amount: totals.amount,
      sortOrder: index,
    };
  });
}

/** Ведомый документ (акт/допсоглашение) не может быть создан без ведущего. */
class LeaderRequiredError extends Error {
  constructor(readonly leader: 'invoice' | 'contract') {
    super(`${leader}_required`);
    this.name = 'LeaderRequiredError';
  }
}

/** Выбранное в форме основание не найдено (или относится к чужому заказу). */
class ParentNotFoundError extends Error {
  constructor() {
    super('parent_not_found');
    this.name = 'ParentNotFoundError';
  }
}
