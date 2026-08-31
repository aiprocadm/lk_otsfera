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
import {
  resolveContractClauses,
  type ContractTemplateOverride,
  type ContractTemplateValues,
} from '@/lib/documents/contractTemplate';
import { renderContractDocumentPdf, type ContractDocumentData } from './contractDocumentPdf';
import {
  renderOrderDocumentPdf,
  type OrderDocumentData,
  type PartyBlock,
} from './orderDocumentPdf';
import { buildPrintTable, fallbackPrintLine, formatMoney, type PrintLineInput } from './printTable';
import { loadDocumentBranding } from './branding';
import { resolveOrgIssueScope } from './issueScope';

/**
 * Выпуск счёта, акта, договора и доп. соглашения по заказу — и **без заказа**
 * (`У-145`): из карточки организации и из сделки. Цель ровно одна: либо
 * `orderId`, либо `organizationId`. Различаются только гейт, происхождение
 * строк и круг «соседних» документов; реквизиты, номер, печать и запись —
 * общие, чтобы документ без заказа не стал вторым, отдельно живущим выпуском.
 *
 * Гейты: staff (manager|leader|admin) + `canSeeOrder` (C8 teamMode-aware) для
 * документа заказа, скоуп организации — для документа без заказа.
 * Полнота реквизитов — до всего, и **набор зависит от типа** (`У-156`).
 * Номер (`У-151`): КАЖДЫЙ документ берёт свой номер атомарным upsert+increment
 * `DocumentCounter(companyId, year, kind)` — счёт и акт делят одну
 * последовательность, договор и ДС другую. Ведомый тип (акт, ДС) номер
 * основания НЕ наследует: связь держит `parentDocumentId`, иначе два ДС к
 * одному договору носили бы один номер (`Д-4`). Год считается по
 * `Europe/Moscow` (`Д-22`). Перевыпуск — только по явной просьбе
 * (`extras.reissueOfDocumentId`): он сохраняет номер, растит версию и гасит
 * прежнюю; без просьбы выпускается НОВЫЙ документ со своим номером (`Д-3`). Файл генерируем сами → `scanStatus='clean'`
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
  /**
   * `У-151`: перевыпуск ИМЕННО ЭТОГО документа. Новая версия сохраняет его
   * номер, а прежняя помечается заменённой. Поля нет — значит выпускается
   * НОВЫЙ документ, и он получает новый номер: до этапа 6 второй счёт по
   * заказу молча «заменял» первый, потому что версия считалась по типу, а не
   * по цепочке (дефект `Д-4`).
   */
  reissueOfDocumentId?: string;
};

export type GenerateArgs = {
  /**
   * Заказ, по которому выпускается документ. Взаимоисключим с
   * `organizationId`: документ без заказа (`У-145`) якорится организацией.
   */
  orderId?: string;
  /** Организация-заказчик документа **без заказа** (`У-145`). */
  organizationId?: string;
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
        | 'act_requires_order'
        | 'lines_required'
        | 'leader_number_required'
        | 'reissue_not_found'
        | 'number_taken'
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

/**
 * Все документы компании-исполнителя (`У-151`).
 *
 * Одного поля мало: у документа заказа компания лежит в заказе, а у документа
 * без заказа — в самом документе (инвариант `У-145`). Наивная выборка по
 * `Document.companyId` увидела бы пустоту там, где живёт большинство
 * документов, и проверка уникальности молча ничего бы не проверяла.
 */
export function companyScopeWhere(companyId: string): Prisma.DocumentWhereInput {
  // После миграции `У-151` компания заполнена у каждого документа, и хватило
  // бы одного поля. Ветка по заказу оставлена намеренно: она ничего не стоит
  // и делает выборку верной ДО применения миграции — а этот код едет на стенд
  // раньше неё.
  return { OR: [{ companyId }, { order: { companyId } }] };
}

/**
 * Год номера — по московскому времени (`У-151`, дефект `Д-22`).
 *
 * `getFullYear()` считает год в часовом поясе процесса: документ, выпущенный
 * 1 января в 02:00 по Москве, на UTC-сервере попал бы в счётчик ПРОШЛОГО года
 * и получил номер, который там уже занят. Расписания в проекте уже живут по
 * `Europe/Moscow` — номер обязан жить там же.
 */
function moscowYear(date: Date): number {
  // `en-CA`, а не `ru-RU`: русская локаль в части сборок ICU форматирует
  // одиночный год как «2026 г.», и `Number()` дал бы `NaN` — номер вышел бы
  // «С-NaN-7». Локаль здесь ни на что не влияет: наружу идёт только число.
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(date)
  );
}

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

/**
 * Кому и по чему выпускаем: заказ ЛИБО организация (`У-145`). Обе двери дают
 * одну и ту же тройку «организация + компания-исполнитель (+ заказ)», поэтому
 * дальше выпуск не различает, откуда пришёл вызов.
 */
type IssueTarget = {
  /** `null` — документ без заказа. */
  order: OrderRow | null;
  organizationId: string;
  companyId: string;
};

type IssueContext = {
  /** `null` — документ без заказа (`У-145`): якорь у него — организация. */
  order: {
    id: string;
    title: string;
    orderNumber: string | null;
    /**
     * Сумма заказа строкой фиксированной точности — для сверки (`У-143`).
     * Живёт ВНУТРИ заказа, а не рядом: без заказа сверять не с чем, и
     * отдельное поле-«может быть» пришлось бы проверять вторым условием.
     */
    total: string;
  } | null;
  organizationId: string;
  companyId: string;
  company: PartyBlock;
  organization: PartyBlock;
  printLines: PrintLineInput[];
  table: ReturnType<typeof buildPrintTable>;
  branding: Awaited<ReturnType<typeof loadDocumentBranding>>;
  /**
   * Свои тексты абзацев договора и ДС (`У-160`) — СЫРЫМИ, как лежат в базе.
   * Собирает из них абзацы одна чистая функция, общая у предпросмотра и
   * выпуска: разойтись им негде.
   */
  templateOverrides: ReadonlyMap<string, ContractTemplateOverride>;
  documentDate: Date;
};

/**
 * Заказ как цель выпуска: гейт `canSeeOrder` (C8, teamMode-aware) и состав
 * заказа для табличной части.
 */
const ORDER_TARGET_SELECT = {
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
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_TARGET_SELECT }>;

async function loadOrderTarget(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<{ ok: true; target: IssueTarget } | IssueFailure> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: ORDER_TARGET_SELECT,
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

  return {
    ok: true,
    target: { order, organizationId: order.organizationId, companyId },
  };
}

/**
 * Организация как цель выпуска — документ **без заказа** (`У-145`).
 *
 * Скоуп здесь свой, и это не дублирование `canSeeOrder`: у документа без
 * заказа нет заказа, по которому проверять видимость. Правило то же, что у
 * карточки организации: админ видит всё, сотрудник ЦО — свою компанию, а вне
 * `teamMode` ещё и только закреплённые за ним организации. Компания берётся
 * **из организации**, а не из формы: подменить её вызовом нельзя.
 */
async function loadOrganizationTarget(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string
): Promise<{ ok: true; target: IssueTarget } | IssueFailure> {
  const scope = await resolveOrgIssueScope(prisma, session, organizationId);
  if (!scope.ok) {
    // «Нет компании-исполнителя» — это нехватка реквизитов, а не отказ по
    // правам: иначе сотрудник искал бы у себя недостающий доступ.
    if (scope.error === 'org_no_company')
      return {
        ok: false,
        error: 'missing_requisites',
        missing: [{ side: 'company', label: 'компания-исполнитель организации' }],
      };
    return { ok: false, error: scope.error };
  }
  return { ok: true, target: { order: null, organizationId, companyId: scope.companyId } };
}

/**
 * Свои тексты абзацев компании (`У-160`).
 *
 * Читаются только для договора и ДС: у счёта и акта редактируемых абзацев нет,
 * и лишний запрос на каждый счёт был бы платой ни за что.
 *
 * **Сбой чтения не отменяет выпуск.** Упавший запрос к шаблону — это причина
 * напечатать документ типовым текстом, а не причина отказать в договоре:
 * бумага нужна человеку сейчас, а формулировка у неё останется той, что была
 * до этапа 6.
 */
async function loadContractTemplate(
  prisma: PrismaClient,
  companyId: string,
  docType: GenerateDocType
): Promise<ReadonlyMap<string, ContractTemplateOverride>> {
  if (docType !== 'contract' && docType !== 'extra_agreement') return new Map();
  try {
    const rows = await prisma.documentTemplate.findMany({
      where: { companyId },
      select: { slot: true, body: true, revision: true },
    });
    return new Map(rows.map((r) => [r.slot, { body: r.body, revision: r.revision }]));
  } catch (e) {
    log.warn('[documents/generate] template read failed, printing built-in text', {
      companyId,
      docType,
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}

/**
 * Общая половина выпуска и предпросмотра (`У-147`): гейты, реквизиты, строки,
 * итоги и оформление. Номер здесь НЕ резервируется — предпросмотр не должен
 * тратить номера из счётчика, иначе в нумерации появлялись бы дыры от каждой
 * «посмотреть, как получится».
 *
 * Дверей две (`У-145`): заказ или организация. Различаются только цель и
 * происхождение строк — реквизиты, итоги, оформление и печать общие.
 */
async function loadIssueContext(
  prisma: PrismaClient,
  session: SessionPayload,
  args: GenerateArgs
): Promise<{ ok: true; ctx: IssueContext } | IssueFailure> {
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };

  // Ровно одна цель. «И заказ, и организация» или «ни того, ни другого» —
  // сломанный вызов; отвечаем как на несуществующий объект, чтобы перебором
  // нельзя было выяснить, что существует (§4).
  if (!!args.orderId === !!args.organizationId) return { ok: false, error: 'not_found' };

  const loaded = args.orderId
    ? await loadOrderTarget(prisma, session, args.orderId)
    : await loadOrganizationTarget(prisma, session, args.organizationId ?? '');
  if (!loaded.ok) return loaded;
  const { order, organizationId, companyId } = loaded.target;

  // `У-145` перечисляет три типа без заказа: счёт, договор, ДС. Акт наследует
  // номер счёта ЗАКАЗА — наследовать без заказа нечего, поэтому запрет живёт
  // на сервере, а не только в наборе вариантов формы.
  if (!order && args.docType === 'act') return { ok: false, error: 'act_requires_order' };

  const [company, organization] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      // Ставка НДС по умолчанию нужна заказу без состава (`У-142`).
      select: { ...PARTY_SELECT, phone: true, email: true, defaultVatRate: true },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: PARTY_SELECT }),
  ]);
  if (!company || !organization) return { ok: false, error: 'not_found' };

  // `У-156`: набор обязательных реквизитов зависит от типа документа.
  const missing = listMissingRequisites(company, organization, args.docType);
  if (missing.length > 0) return { ok: false, error: 'missing_requisites', missing };

  const documentDate = args.extras?.documentDate ?? args.now ?? new Date();

  // Табличная часть (`У-141`, `У-142`): строки из формы выпуска, иначе состав
  // заказа, иначе одна строка-заглушка на сумму заказа.
  const formLines = args.lines && args.lines.length > 0 ? args.lines : null;
  let printLines: PrintLineInput[];
  if (formLines) {
    printLines = formLines;
  } else if (order) {
    printLines =
      order.lines.length > 0
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
  } else {
    // `У-145`: состав документа без заказа вводится в форме. Запасной строки
    // здесь взять неоткуда — придумать сумму «за клиента» хуже, чем отказать.
    return { ok: false, error: 'lines_required' };
  }
  const table = buildPrintTable(printLines);

  // Оформление (`У-153`) читаем ДО транзакции: картинки не зависят от номера,
  // а держать транзакцию на время скачивания из хранилища незачем.
  const branding = await loadDocumentBranding(prisma, companyId);
  const templateOverrides = await loadContractTemplate(prisma, companyId, args.docType);

  return {
    ok: true,
    ctx: {
      order: order
        ? {
            id: order.id,
            title: order.title,
            orderNumber: order.orderNumber,
            total: order.totalAmount.toFixed(2),
          }
        : null,
      organizationId,
      companyId,
      company: party(company),
      organization: party(organization),
      printLines,
      table,
      branding,
      templateOverrides,
      documentDate,
    },
  };
}

/** Значения подстановок шаблона (`У-160`) — готовыми строками. */
function contractValues(ctx: IssueContext, args: GenerateArgs): ContractTemplateValues {
  return {
    // Без заказа названия заказа нет — типовая формулировка честнее пустой
    // строки в предмете договора.
    subject: args.extras?.subject?.trim() || ctx.order?.title || 'Оказание услуг',
    date: ctx.documentDate.toLocaleDateString('ru-RU'),
    // Срок печатается куском фразы, а не датой: у бессрочного договора даты
    // нет вовсе, а «действует до —» читалось бы как потерянное значение.
    term: args.extras?.validUntil
      ? `до ${new Date(args.extras.validUntil).toLocaleDateString('ru-RU')}`
      : 'до полного исполнения Сторонами обязательств',
    company: ctx.company.displayName,
    organization: ctx.organization.displayName,
    total: formatMoney(ctx.table.gross),
    inWords: ctx.table.totalInWords,
  };
}

/** Готовый PDF плюс то, чем он напечатан (`У-160`). */
type RenderedDocument = {
  buffer: Buffer;
  /** Редакция шаблона: `0` — встроенный текст, `null` — у типа шаблона нет. */
  templateVersion: number | null;
  /** «Слот → откуда взят абзац» для журнала действий; текстов здесь нет. */
  templateSources: Record<string, string> | null;
};

/** Собрать данные шаблона: одинаково для выпуска и для предпросмотра. */
async function renderDocument(
  ctx: IssueContext,
  args: GenerateArgs,
  number: string,
  draftNote: string | null
): Promise<RenderedDocument> {
  if (args.docType === 'contract' || args.docType === 'extra_agreement') {
    // Абзацы собираются ОДНИМ вызовом на оба пути: предпросмотр и выпуск
    // печатают посимвольно один текст, потому что берут его отсюда.
    const resolved = resolveContractClauses({
      docType: args.docType,
      values: contractValues(ctx, args),
      overrides: ctx.templateOverrides,
      form: {
        paymentTerms: args.extras?.paymentTerms ?? null,
        changeText: args.extras?.changeText ?? null,
      },
    });
    const contractData: ContractDocumentData = {
      docType: args.docType,
      number,
      date: ctx.documentDate,
      company: ctx.company,
      organization: ctx.organization,
      clauses: resolved.clauses,
      table: ctx.table,
      branding: ctx.branding,
      baseContract: args.baseContract ?? null,
      draftNote,
    };
    return {
      buffer: await renderContractDocumentPdf(contractData),
      templateVersion: resolved.usedRevision,
      templateSources: resolved.sources,
    };
  }
  const data: OrderDocumentData = {
    docType: args.docType,
    number,
    date: ctx.documentDate,
    company: ctx.company,
    organization: ctx.organization,
    // `У-145`: у документа без заказа подзаголовка нет — печатать «Заказ
    // «без названия»» значило бы придумать несуществующую связь.
    orderLabel: ctx.order
      ? `Заказ ${ctx.order.orderNumber ? `№${ctx.order.orderNumber} ` : ''}«${ctx.order.title}»`
      : null,
    table: ctx.table,
    branding: ctx.branding,
    servicePeriod:
      args.extras?.periodFrom && args.extras.periodTo
        ? { from: args.extras.periodFrom, to: args.extras.periodTo }
        : null,
    draftNote,
  };
  // У счёта и акта редактируемых абзацев нет — писать им редакцию шаблона
  // значило бы приписать документу текст, которого в нём не было.
  return {
    buffer: await renderOrderDocumentPdf(data),
    templateVersion: null,
    templateSources: null,
  };
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
  const rendered = await renderDocument(
    loaded.ctx,
    args,
    '—',
    'ПРЕДПРОСМОТР. Номер будет присвоен при выпуске.'
  );
  return { ok: true, buffer: rendered.buffer };
}

export async function generateOrderDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: GenerateArgs
): Promise<GenerateResult> {
  const loaded = await loadIssueContext(prisma, session, args);
  if (!loaded.ok) return loaded;
  const { ctx } = loaded;
  const { order, companyId, organizationId, table, printLines } = ctx;
  const now = args.now ?? new Date();
  const year = moscowYear(ctx.documentDate);

  /**
   * Соседи документа — те, среди которых ищутся основание и предыдущая версия
   * (`У-147`, `У-151`). У документа заказа это документы заказа, у документа
   * без заказа — документы той же организации, тоже без заказа: смешивать
   * нельзя, иначе ДС организации привязалось бы к договору чужого заказа.
   */
  const siblingWhere: Prisma.DocumentWhereInput = order
    ? { orderId: order.id }
    : {
        orderId: null,
        companyId,
        counterpartyType: 'organization',
        counterpartyId: organizationId,
      };

  // `У-143` (дефект `Д-8`): расхождение суммы строк с суммой заказа — вопрос
  // человеку, а не молчаливый выбор одной из двух цифр. Без заказа сверять не
  // с чем: сумма документа и есть сумма строк.
  const isMoneyDocument = args.docType === 'invoice' || args.docType === 'act';
  if (isMoneyDocument && order && table.gross !== order.total) {
    if (!args.onAmountMismatch) {
      return {
        ok: false,
        error: 'amount_mismatch',
        linesTotal: table.gross,
        orderTotal: order.total,
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
        after: { before: order.total, after: table.gross, reason: 'document_issue' },
      });
    }
  }

  // --- Шаг 1: короткая транзакция — номер и версия (`У-152`, `У-151`) --------
  let reserved: {
    number: string;
    version: number;
    previousId: string | null;
    parentId: string | null;
    baseDoc: { number: string; date: Date } | null;
  };
  try {
    reserved = await prisma.$transaction(async (tx) => {
      // `У-151`: основание акта и ДС — ЯВНОЕ поле, а не совпадение номеров.
      // До этапа 6 ведомый документ выдёргивал число из номера основания и
      // склеивал его со своим префиксом и своим годом: два доп. соглашения к
      // одному договору получали один номер (`Д-4`), а акт, выпущенный в
      // январе, получал номер прошлогоднего счёта с новым годом.
      const leader = LEADER_OF[args.docType];
      let baseDoc: { number: string; date: Date } | null = null;
      let parentId: string | null = null;
      if (leader !== null) {
        const found = args.extras?.parentDocumentId
          ? await tx.document.findFirst({
              where: {
                id: args.extras.parentDocumentId,
                ...siblingWhere,
                type: leader,
                // Заменённая версия основанием быть не может: акт привязался
                // бы к бумаге, которой у заказчика уже нет. Форма её и не
                // предлагает — но форма могла быть открыта до перевыпуска.
                supersededAt: null,
              },
              select: { id: true, number: true, createdAt: true },
            })
          : await tx.document.findFirst({
              where: {
                ...siblingWhere,
                type: leader,
                generatedBy: 'system',
                supersededAt: null,
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true, number: true, createdAt: true },
            });
        if (!found) {
          throw args.extras?.parentDocumentId
            ? new ParentNotFoundError()
            : new LeaderRequiredError(leader);
        }
        // `Д-5`: ведущий документ из 1С приходит БЕЗ номера. Раньше это давало
        // «сначала выпустите счёт» — человек видел счёт на экране и не понимал
        // отказа. Теперь отвечаем честно: номер нужно указать.
        if (!found.number) throw new LeaderNumberRequiredError();
        parentId = found.id;
        baseDoc = { number: found.number, date: found.createdAt };
      }

      // Перевыпуск (`У-151`): номер сохраняется, версия растёт, прежняя
      // помечается заменённой. Без указания документа выпускается НОВЫЙ, и он
      // всегда получает свой номер — «второй документ того же типа» больше не
      // притворяется версией первого (`Д-4`), а перевыпуск больше не жжёт
      // номер из счётчика (`Д-3`).
      if (args.extras?.reissueOfDocumentId) {
        const previous = await tx.document.findFirst({
          where: {
            id: args.extras.reissueOfDocumentId,
            ...siblingWhere,
            type: args.docType,
            number: { not: null },
            supersededAt: null,
          },
          select: { id: true, number: true, version: true, parentDocumentId: true },
        });
        if (!previous) throw new ReissueNotFoundError();
        return {
          // Номер не берётся из счётчика: перевыпуск — это та же бумага.
          number: previous.number!,
          version: previous.version + 1,
          previousId: previous.id,
          // Основание наследуется от заменяемой версии, если его не выбрали
          // заново: иначе акт перевыпуском отвязался бы от своего счёта.
          parentId: parentId ?? previous.parentDocumentId,
          baseDoc,
        };
      }

      const counter = await tx.documentCounter.upsert({
        where: { companyId_year_kind: { companyId, year, kind: COUNTER_KIND[args.docType] } },
        create: { companyId, year, kind: COUNTER_KIND[args.docType], lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      return {
        number: `${NUMBER_PREFIX[args.docType]}-${year}-${counter.lastNumber}`,
        version: 1,
        previousId: null,
        parentId,
        baseDoc,
      };
    });
  } catch (e) {
    if (e instanceof ParentNotFoundError) return { ok: false, error: 'parent_not_found' };
    if (e instanceof LeaderNumberRequiredError)
      return { ok: false, error: 'leader_number_required' };
    if (e instanceof ReissueNotFoundError) return { ok: false, error: 'reissue_not_found' };
    if (e instanceof LeaderRequiredError) {
      return {
        ok: false,
        error: e.leader === 'invoice' ? 'invoice_required' : 'contract_required',
      };
    }
    throw e;
  }

  // `У-151`: «две разные цепочки с одним номером невозможны — проверяется
  // сервисом при выпуске, а не только индексом». Индекс появится миграцией
  // данных (PR-8b) и защитит от гонки; здесь — понятный отказ вместо ошибки
  // базы, и работает он уже сейчас.
  const clash = await prisma.document.findFirst({
    where: {
      ...companyScopeWhere(companyId),
      type: args.docType,
      number: reserved.number,
      version: reserved.version,
    },
    select: { id: true },
  });
  if (clash) return { ok: false, error: 'number_taken' };

  // --- Шаг 2: рендер и загрузка ВНЕ транзакции (`У-152`) ---------------------
  const rendered = await renderDocument(
    ctx,
    { ...args, baseContract: reserved.baseDoc },
    reserved.number,
    null
  );
  const buffer = rendered.buffer;

  // Ключ с UUID (`Д-2`): повторный выпуск не перезаписывает прежний файл, а
  // сбойная попытка не оставляет за собой «занятое» имя.
  // Документ без заказа кладём под организацию: путь `orders/<id>/…` для него
  // назвал бы несуществующий заказ, а разбор хранилища идёт по префиксу.
  const pathPrefix = order ? `orders/${order.id}` : `organizations/${organizationId}`;
  const path = `${pathPrefix}/generated/${args.docType}-v${reserved.version}-${randomUUID()}.pdf`;
  try {
    await getObjectStorage().upload(path, buffer, { contentType: 'application/pdf' });
  } catch (e) {
    log.error('[documents/generate] upload failed', {
      orderId: order?.id ?? null,
      organizationId,
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
          // `У-151`: компания есть у КАЖДОГО документа — уникальность номера
          // требуется по ней. У документа заказа она обязана совпадать с
          // компанией заказа; это держит составной внешний ключ, а не наша
          // аккуратность.
          companyId,
          ...(order ? { orderId: order.id } : {}),
          counterpartyType: 'organization',
          counterpartyId: organizationId,
          uploadedById: session.sub,
          scanStatus: 'clean',
          scannedAt: now,
          // `У-160`: чем НАПЕЧАТАН этот документ. Считается по абзацам,
          // которые реально попали в бумагу, — как чек, где перечислено
          // только купленное.
          templateVersion: rendered.templateVersion,
          // `У-146`: строки — снимок состава на момент выпуска. Правка заказа
          // задним числом выставленный документ не меняет.
          lines: { create: snapshotLines(printLines) },
        } as Prisma.DocumentUncheckedCreateInput,
        select: { id: true },
      });

      // `У-151`: прежняя версия помечается заменённой ТОЙ ЖЕ транзакцией, что
      // создаёт новую. Пометь мы её раньше — сбой записи оставил бы заказ без
      // действующего документа вовсе; позже — на секунду показались бы две
      // действующие версии одного номера.
      if (reserved.previousId) {
        await tx.document.update({
          where: { id: reserved.previousId },
          data: { supersededAt: now },
        });
      }

      await recordAudit(tx, {
        userId: session.sub,
        action: 'document_generated',
        entity: 'document',
        entityId: doc.id,
        after: {
          orderId: order?.id ?? null,
          organizationId,
          docType: args.docType,
          number: reserved.number,
          version: reserved.version,
          amountGross: table.gross,
          // Текстов в журнал не пишем — они могут содержать данные клиента;
          // остаётся только «какой абзац откуда взят».
          templateVersion: rendered.templateVersion,
          templateSources: rendered.templateSources,
          // `У-151`: по журналу должно быть видно, перевыпуск это или новый
          // документ, — номер у них одинаковый, а смысл разный.
          reissueOf: reserved.previousId,
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
      organizationId,
      type: 'document_published',
      payload: {
        // Пустой заказ письмо уже умеет (`orderId === null` ведёт в раздел
        // общих документов кабинета) — своей ветки уведомления не заводим.
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? null,
        orderTitle: order?.title ?? null,
        documentName: `${reserved.number}.pdf`,
        documentType: args.docType,
      },
    });
  } catch (err) {
    log.warn('[documents/generate] notify failed', {
      orderId: order?.id ?? null,
      organizationId,
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

/** Ведущий документ есть, но у него нет номера (пришёл из 1С) — `Д-5`. */
class LeaderNumberRequiredError extends Error {
  constructor() {
    super('leader_number_required');
    this.name = 'LeaderNumberRequiredError';
  }
}

/** Перевыпускать нечего: документ не найден, без номера или уже заменён. */
class ReissueNotFoundError extends Error {
  constructor() {
    super('reissue_not_found');
    this.name = 'ReissueNotFoundError';
  }
}

/** Выбранное в форме основание не найдено (или относится к чужому заказу). */
class ParentNotFoundError extends Error {
  constructor() {
    super('parent_not_found');
    this.name = 'ParentNotFoundError';
  }
}
