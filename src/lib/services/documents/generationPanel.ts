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

/**
 * Нехватка реквизитов по каждому виду документа.
 *
 * **Собирается ЛИТЕРАЛОМ, а не циклом по списку видов, и это главное здесь.**
 * Раньше был цикл по массиву `DOC_KINDS` из четырёх видов, а тип результата
 * обещал пять — разрыв прикрывался кастом `{} as Record<…>`. Ключа
 * `commercial_proposal` в объекте не было вовсе; форма читает его через
 * `?? []`, поэтому «реквизитов не хватает» превращалось в «всё в порядке», и
 * человек упирался в отказ сервиса уже ПОСЛЕ нажатия «Выпустить».
 *
 * Массив с `satisfies` эту дыру не закрывает: он гарантирует, что каждый
 * элемент — валидный вид, но не что каждый вид попал в список. А литерал с
 * обязательными ключами просто не соберётся, если новый вид забыли, — и
 * узнаем мы об этом от компилятора, а не от клиента.
 *
 * Функция одна на все панели: тот же расчёт был выписан в трёх местах, и
 * забытый вид пришлось бы чинить трижды.
 */
function buildMissingByType(
  company: Parameters<typeof listMissingRequisites>[0] | null,
  organization: Parameters<typeof listMissingRequisites>[1] | null
): Record<RequisitesDocKind, MissingRequisite[]> {
  const of = (kind: RequisitesDocKind): MissingRequisite[] =>
    company && organization ? listMissingRequisites(company, organization, kind) : [];
  return {
    invoice: of('invoice'),
    act: of('act'),
    contract: of('contract'),
    extra_agreement: of('extra_agreement'),
    commercial_proposal: of('commercial_proposal'),
  };
}

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
        // `Д-5`: счёт, приехавший из 1С, приходит БЕЗ номера. Раньше он
        // включал кнопку «Акт», а выпуск падал «сначала выпустите счёт» —
        // человек видел счёт на экране и не понимал отказа. Основанием
        // считается только документ, которому есть что наследовать.
        number: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.document.findMany({
      where: {
        orderId: args.orderId,
        type: { in: ['invoice', 'contract'] },
        number: { not: null },
        // Заменённая версия основанием быть не может: акт привязался бы к
        // бумаге, которой у заказчика уже нет.
        supersededAt: null,
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
  const missingByType = buildMissingByType(company, organization);
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

/**
 * Читающая половина выпуска документа **без заказа** (`У-145`) — для вкладки
 * «Документы» карточки организации и для карточки сделки.
 *
 * Отличий от панели заказа три, и все они следуют из отсутствия заказа:
 * состава для предзаполнения нет (строки вводятся в форме), «соседями» для
 * выбора основания служат документы той же организации **без заказа**, а
 * каталог услуг компании нужен здесь всегда — иначе строку пришлось бы
 * набирать руками целиком.
 *
 * Скоуп: доступ к организации проверяет вызывающая страница (карточка
 * организации уже прошла `requireManagerForOrg`), а `companyId` читается из
 * организации, а не приходит из формы. Гард выпуска — в мутации.
 */

/** Позиция каталога для подстановки строки (`У-145`). */
export type IssueCatalogOption = {
  id: string;
  name: string;
  code: string;
  unit: CatalogUnit;
  /** `Decimal` через границу server→client не проходит — строки. */
  price: string;
  vatRate: string | null;
  vatIncluded: boolean;
};

export type OrgDocumentIssuePanel = {
  missingByType: Record<RequisitesDocKind, MissingRequisite[]>;
  /**
   * Ставка НДС по умолчанию компании-исполнителя (`У-138`). Ей заполняются
   * строки, набранные вручную: оставить их «без НДС» значило бы выставить
   * плательщику НДС документ без налога — и человек этого не заметит, потому
   * что поле выглядит просто пустым.
   */
  defaultVatRate: string | null;
  /** Договоры организации без заказа — из них выбирают основание ДС. */
  baseDocuments: IssueBaseDocument[];
  hasContract: boolean;
  counterpartyName: string;
  catalog: IssueCatalogOption[];
  /**
   * Сколько дней действует коммерческое предложение по умолчанию (`У-162`).
   *
   * Отдаём ЧИСЛО ДНЕЙ, а не готовую дату. Сервер может жить в UTC, а форма
   * считает «сегодня» по часовому поясу браузера: готовая дата разошлась бы
   * на сутки у половины страны, и предложение выглядело бы истёкшим на день
   * раньше.
   */
  proposalValidDays: number;
};

/**
 * Каталог целиком, но не бесконечно: форма ищет по названию на клиенте, а
 * тащить в браузер десятки тысяч позиций незачем (тот же предел, что у
 * блока «Состав и стоимость» заказа).
 */
const CATALOG_LIMIT = 500;

/**
 * Запасной срок действия КП, если компания вдруг не прочиталась. Совпадает со
 * значением по умолчанию в схеме (`Company.proposalValidDays`): разойдись они,
 * форма показывала бы один срок, а напоминание об истечении считало другой.
 */
const DEFAULT_PROPOSAL_VALID_DAYS = 14;

export async function getOrgDocumentIssuePanel(
  prisma: PrismaClient,
  args: { organizationId: string; companyId: string }
): Promise<OrgDocumentIssuePanel> {
  const [company, organization, baseRows, catalogRows] = await Promise.all([
    prisma.company.findUnique({
      where: { id: args.companyId },
      select: { ...REQUISITES_SELECT, defaultVatRate: true, proposalValidDays: true },
    }),
    prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: REQUISITES_SELECT,
    }),
    prisma.document.findMany({
      where: {
        // Ровно те же «соседи», что видит выпуск: документы этой организации
        // без заказа. Договор ЗАКАЗА в основания ДС без заказа не попадает —
        // иначе форма предлагала бы связь, которую сервис отклонит.
        orderId: null,
        companyId: args.companyId,
        counterpartyType: 'organization',
        counterpartyId: args.organizationId,
        type: 'contract',
        generatedBy: 'system',
        number: { not: null },
        // Заменённая версия основанием быть не может — так же, как у панели
        // заказа: ДС привязалось бы к бумаге, которой у заказчика уже нет.
        supersededAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, number: true, createdAt: true },
    }),
    prisma.catalogItem.findMany({
      where: { companyId: args.companyId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        unit: true,
        price: true,
        vatRate: true,
        vatIncluded: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: CATALOG_LIMIT,
    }),
  ]);

  const missingByType = buildMissingByType(company, organization);

  return {
    missingByType,
    // Формат — как у строк заказа (4 знака): форма сравнивает предзаполненное
    // значение со списком ставок, разный формат ломал бы выбор.
    defaultVatRate: company?.defaultVatRate ? company.defaultVatRate.toFixed(4) : null,
    baseDocuments: baseRows.map((row) => ({
      id: row.id,
      type: row.type,
      // Номер не пуст по условию выборки; хвост оставлен ради типа.
      number: row.number ?? '',
      date: row.createdAt.toISOString(),
    })),
    hasContract: baseRows.length > 0,
    counterpartyName: organization?.legalName?.trim() || organization?.name?.trim() || 'заказчик',
    proposalValidDays: company?.proposalValidDays ?? DEFAULT_PROPOSAL_VALID_DAYS,
    catalog: catalogRows.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      unit: item.unit,
      price: item.price.toFixed(2),
      // Формат ставки — как у строк заказа (4 знака): форма сравнивает
      // предзаполненное значение с текущим, разный формат ломал бы выбор.
      vatRate: item.vatRate === null ? null : item.vatRate.toFixed(4),
      vatIncluded: item.vatIncluded,
    })),
  };
}

/**
 * Данные формы ПЕРЕВЫПУСКА (`У-151`).
 *
 * Перевыпуск начинается не с пустой формы, а с того, что напечатано в самом
 * документе: строки берутся его снимком (`У-146`), а не текущим составом
 * заказа. Иначе «перевыпустить с исправленной опечаткой» молча подтянуло бы
 * заказ, изменившийся с тех пор, и новая версия разошлась бы со старой не там,
 * где человек ожидал.
 */
export type ReissuePanel = {
  docType: string;
  /** Куда выпускать: заказ или организация (`У-145`). */
  target: { kind: 'order'; orderId: string } | { kind: 'organization'; organizationId: string };
  counterpartyName: string;
  missingByType: Record<RequisitesDocKind, MissingRequisite[]>;
  baseDocuments: IssueBaseDocument[];
  hasInvoice: boolean;
  hasContract: boolean;
  /** Состав заменяемой версии — им открывается форма. */
  lines: IssuePrefillLine[];
  catalog: IssueCatalogOption[];
};

/**
 * Данные формы выпуска для ЛИДА (`У-161`, этап 7).
 *
 * Тип возврата тот же, что у организации, и это сознательно: форма одна, и
 * второй почти-такой-же тип заставил бы её ветвиться в каждом поле. Разница
 * между целями укладывается в значения, а не в структуру:
 *
 * - `baseDocuments` пуст и `hasContract: false` — договоров у лида нет по
 *   определению, выбирать основание не из чего;
 * - `counterpartyName` — название клиента из карточки лида: юр. лица ещё нет;
 * - компания берётся ИЗ СЕССИИ (её уже проверил `resolveLeadIssueScope`), а не
 *   из данных клиента — у лида её негде взять.
 */
export async function getLeadDocumentIssuePanel(
  prisma: PrismaClient,
  args: { companyId: string; leadName: string }
): Promise<OrgDocumentIssuePanel> {
  const [company, catalogRows] = await Promise.all([
    prisma.company.findUnique({
      where: { id: args.companyId },
      select: { ...REQUISITES_SELECT, defaultVatRate: true, proposalValidDays: true },
    }),
    prisma.catalogItem.findMany({
      where: { companyId: args.companyId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        unit: true,
        price: true,
        vatRate: true,
        vatIncluded: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: CATALOG_LIMIT,
    }),
  ]);

  /**
   * Заказчик-лид для проверки реквизитов: известно только название. Тот же
   * приём, что в генераторе, — синтетическая сторона вместо «стороны может не
   * быть»: пятому набору (`У-161`) от заказчика нужно ровно название, и он
   * честно скажет, если и его нет.
   */
  const leadParty = {
    name: args.leadName,
    legalName: null,
    inn: null,
    kpp: null,
    ogrn: null,
    legalAddress: null,
    bankName: null,
    bankAccount: null,
    corrAccount: null,
    bic: null,
    signerName: null,
    signerPosition: null,
    signerBasis: null,
  };

  return {
    missingByType: buildMissingByType(company, leadParty),
    defaultVatRate: company?.defaultVatRate ? company.defaultVatRate.toFixed(4) : null,
    baseDocuments: [],
    hasContract: false,
    counterpartyName: args.leadName.trim() || 'клиент',
    catalog: catalogRows.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      unit: item.unit,
      price: item.price.toFixed(2),
      vatRate: item.vatRate === null ? null : item.vatRate.toFixed(4),
      vatIncluded: item.vatIncluded,
    })),
    proposalValidDays: company?.proposalValidDays ?? DEFAULT_PROPOSAL_VALID_DAYS,
  };
}
