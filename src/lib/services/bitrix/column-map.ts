import { normalizeLabel } from '@/lib/services/import/normalize';
import { cellText } from './cells';

/**
 * Шапки выгрузок Битрикс24 → поля источника (`У-189` file, спека §3.1).
 *
 * Выгрузка «Экспорт в CSV/Excel» называет колонки словами интерфейса, причём
 * по-русски или по-английски в зависимости от языка портала, а реквизиты
 * (ИНН, КПП) приходят как «Реквизит: ИНН». Каждое поле — МАССИВ алиасов: первый
 * — «основное» имя, его показывает диагностика («не хватает колонки …»).
 * Сравнение нормализованное (`normalize.ts`): регистр, «ё/е», неразрывные
 * пробелы и переносы значения не имеют.
 *
 * Идентификаторов связей в выгрузке обычно нет — «Компания» у контакта и
 * «Ответственный» у сделки приходят названием и именем. Поэтому у связей два
 * поля: `…Id` (если портал выгрузил колонку с ID) и `…Title`/`…Name`, по
 * которому адаптер ищет запись в соседнем файле или заводит пользователя по
 * имени (в предпросмотре такой пользователь — «не сопоставлен»).
 */
export type BitrixFileEntity = 'company' | 'contact' | 'lead' | 'deal' | 'task';

export const BITRIX_FILE_ENTITIES: readonly BitrixFileEntity[] = [
  'company',
  'contact',
  'lead',
  'deal',
  'task',
];

/** Русские названия сущностей для формы и отчёта (глоссарий: «Компании Битрикс24» = организации ЛК). */
export const BITRIX_ENTITY_LABELS: Record<BitrixFileEntity, string> = {
  company: 'Компании',
  contact: 'Контакты',
  lead: 'Лиды',
  deal: 'Сделки',
  task: 'Задачи',
};

const ASSIGNED_ID = ['ID ответственного', 'Responsible ID', 'Assigned by ID', 'ASSIGNED_BY_ID'];
const ASSIGNED_NAME = ['Ответственный', 'Responsible', 'Responsible person', 'Assigned by'];
const CREATED_AT = ['Дата создания', 'Создано', 'Создан', 'Date created', 'Created on', 'Created'];
const COMMENTS = ['Комментарий', 'Комментарии', 'Comment', 'Comments'];
const PHONES = [
  'Телефон',
  'Рабочий телефон',
  'Мобильный телефон',
  'Домашний телефон',
  'Другой телефон',
  'Phone',
  'Work phone',
  'Mobile phone',
  'Home phone',
  'Other phone',
];
const EMAILS = [
  'E-mail',
  'Email',
  'Рабочий e-mail',
  'Личный e-mail',
  'Другой e-mail',
  'Work e-mail',
  'Personal e-mail',
  'Other e-mail',
];
const INN = ['ИНН', 'Реквизит: ИНН', 'Реквизиты: ИНН', 'INN', 'Tax ID'];
const OPPORTUNITY = ['Сумма', 'Сумма сделки', 'Amount', 'Opportunity', 'Total'];

const BITRIX_COLS = {
  company: {
    id: ['ID', 'Идентификатор', 'Company ID'],
    title: ['Название компании', 'Название', 'Наименование', 'Company name', 'Company', 'Title'],
    inn: INN,
    kpp: ['КПП', 'Реквизит: КПП', 'Реквизиты: КПП', 'KPP'],
    assignedById: ASSIGNED_ID,
    assignedByName: ASSIGNED_NAME,
    createdAt: CREATED_AT,
    comments: COMMENTS,
  },
  contact: {
    id: ['ID', 'Идентификатор', 'Contact ID'],
    name: ['Имя', 'Name', 'First name'],
    lastName: ['Фамилия', 'Last name', 'Surname'],
    post: ['Должность', 'Position', 'Post'],
    companyId: ['ID компании', 'Company ID', 'COMPANY_ID'],
    companyTitle: ['Компания', 'Название компании', 'Company', 'Company name'],
    phones: PHONES,
    emails: EMAILS,
    assignedById: ASSIGNED_ID,
    assignedByName: ASSIGNED_NAME,
    createdAt: CREATED_AT,
  },
  lead: {
    id: ['ID', 'Идентификатор', 'Lead ID'],
    title: ['Название лида', 'Название', 'Lead name', 'Title'],
    name: ['Имя', 'Контакт', 'Name', 'First name'],
    lastName: ['Фамилия', 'Last name', 'Surname'],
    companyTitle: ['Название компании', 'Компания', 'Company name', 'Company'],
    phones: PHONES,
    emails: EMAILS,
    inn: INN,
    statusId: ['ID стадии', 'ID статуса', 'Stage ID', 'Status ID', 'STATUS_ID'],
    statusName: [
      'Стадия',
      'Статус',
      'Стадия лида',
      'Статус лида',
      'Stage',
      'Status',
      'Lead status',
    ],
    assignedById: ASSIGNED_ID,
    assignedByName: ASSIGNED_NAME,
    opportunity: OPPORTUNITY,
    createdAt: CREATED_AT,
    comments: COMMENTS,
  },
  deal: {
    id: ['ID', 'Идентификатор', 'Deal ID'],
    title: ['Название сделки', 'Название', 'Deal name', 'Title'],
    categoryId: ['ID направления', 'ID воронки', 'Category ID', 'Pipeline ID', 'CATEGORY_ID'],
    categoryName: ['Направление', 'Воронка', 'Pipeline', 'Category'],
    stageId: ['ID стадии', 'Stage ID', 'STAGE_ID'],
    stageName: ['Стадия сделки', 'Стадия', 'Deal stage', 'Stage'],
    opportunity: OPPORTUNITY,
    companyId: ['ID компании', 'Company ID', 'COMPANY_ID'],
    companyTitle: ['Компания', 'Название компании', 'Company', 'Company name'],
    contactId: ['ID контакта', 'Contact ID', 'CONTACT_ID'],
    contactName: ['Контакт', 'Contact'],
    leadId: ['ID лида', 'Lead ID', 'LEAD_ID'],
    assignedById: ASSIGNED_ID,
    assignedByName: ASSIGNED_NAME,
    createdAt: CREATED_AT,
    closeDate: [
      'Дата закрытия',
      'Дата завершения',
      'Предполагаемая дата закрытия',
      'Close date',
      'Closing date',
      'Expected close date',
    ],
    closed: ['Сделка закрыта', 'Закрыта', 'Deal closed', 'Closed'],
    comments: COMMENTS,
  },
  task: {
    id: ['ID', 'Идентификатор', 'Task ID'],
    title: ['Название', 'Название задачи', 'Задача', 'Name', 'Title', 'Task'],
    description: ['Описание', 'Description'],
    status: ['Статус', 'Status'],
    responsibleId: ['ID ответственного', 'ID исполнителя', 'Responsible ID', 'Assignee ID'],
    responsibleName: ['Ответственный', 'Исполнитель', 'Responsible', 'Assignee'],
    createdById: ['ID постановщика', 'Created by ID', 'Creator ID'],
    createdByName: ['Постановщик', 'Кем создана', 'Created by', 'Creator'],
    deadline: ['Крайний срок', 'Deadline', 'Due date'],
    createdAt: CREATED_AT,
    closedAt: [
      'Дата завершения',
      'Дата закрытия',
      'Завершена',
      'Date closed',
      'Closed on',
      'Completed on',
    ],
    crm: ['CRM', 'Элементы CRM', 'Привязка к CRM', 'CRM items', 'CRM elements'],
  },
} as const;

type BitrixColumnMap = typeof BITRIX_COLS;
export type BitrixField<E extends BitrixFileEntity> = keyof BitrixColumnMap[E] & string;

/**
 * Колонки, без которых файл сущности не имеет смысла: их отсутствие — не
 * предупреждение, а отказ распознать файл. Вложенный массив — «хотя бы одна из»
 * (стадия сделки может прийти названием или ID); первым стоит то, что человек
 * видит в выгрузке — его и называет подсказка «не хватает колонки …».
 */
const REQUIRED_BITRIX_COLS: {
  [E in BitrixFileEntity]: ReadonlyArray<ReadonlyArray<BitrixField<E>>>;
} = {
  company: [['id'], ['title']],
  contact: [['id'], ['name', 'lastName']],
  lead: [['id'], ['title'], ['statusName', 'statusId']],
  deal: [['id'], ['title'], ['stageName', 'stageId']],
  task: [['id'], ['title'], ['status']],
};

/** Поля-множества: значения собираются из ВСЕХ совпавших колонок («Рабочий телефон» + «Мобильный телефон»). */
const MULTI_FIELDS: ReadonlySet<string> = new Set(['phones', 'emails']);

export type ResolvedColumns<E extends BitrixFileEntity> = {
  /** Индексы колонок по полям; у обычных полей — первая совпавшая, у множеств — все. */
  index: Partial<Record<BitrixField<E>, number[]>>;
  /** Заголовки файла, которые ни одному полю не подошли (предупреждение диагностики). */
  unmatched: string[];
  /** Обязательные поля, которых нет — основным именем первого алиаса группы. */
  missing: string[];
};

/**
 * Сопоставление шапки файла с полями сущности. Заголовок отдаётся первому
 * полю (в порядке объявления), чей алиас совпал, и больше никому.
 */
export function resolveBitrixColumns<E extends BitrixFileEntity>(
  entity: E,
  headers: readonly unknown[]
): ResolvedColumns<E> {
  const cols = BITRIX_COLS[entity] as Record<string, readonly string[]>;
  const normalizedAliases = new Map<string, string[]>();
  for (const [field, aliases] of Object.entries(cols)) {
    normalizedAliases.set(
      field,
      aliases.map((a) => normalizeLabel(a))
    );
  }
  const index: Record<string, number[]> = {};
  const unmatched: string[] = [];
  headers.forEach((raw, i) => {
    const label = cellText(raw);
    if (!label) return;
    const norm = normalizeLabel(label);
    for (const [field, aliases] of normalizedAliases) {
      if (!aliases.includes(norm)) continue;
      const existing = index[field];
      if (!existing) index[field] = [i];
      else if (MULTI_FIELDS.has(field)) existing.push(i);
      else return; // повтор обычной колонки — берём первую, вторую не считаем чужой
      return;
    }
    unmatched.push(label);
  });
  const missing: string[] = [];
  for (const group of REQUIRED_BITRIX_COLS[entity] as ReadonlyArray<ReadonlyArray<string>>) {
    if (group.some((f) => index[f])) continue;
    // Группа обязательных колонок непустая, а её поля — ключи той же карты:
    // оба индекса доказуемо валидны (список выше в этом же файле).
    missing.push(cols[group[0]!]![0]!);
  }
  return { index: index as ResolvedColumns<E>['index'], unmatched, missing };
}

/** Диагностика файла выгрузки: что за сущность, сколько строк, какие колонки не распознаны или отсутствуют. */
export type BitrixFileDiagnostic = {
  name: string;
  entity: BitrixFileEntity | null;
  candidate: BitrixFileEntity | null;
  rows: number;
  unmatchedHeaders: string[];
  missing: string[];
};

export type EntityDetection = {
  /** Сущность файла; `null` — шапка не подошла ни одной сущности или подошла двум одинаково. */
  entity: BitrixFileEntity | null;
  /** Ближайший кандидат, когда `entity` = null («похоже на сделки, но нет колонки …»). */
  candidate: BitrixFileEntity | null;
  unmatched: string[];
  missing: string[];
};

/**
 * Сущность по набору заголовков: побеждает та, у которой есть все обязательные
 * колонки и больше всего распознанных; равный счёт двух лидеров — отказ
 * (пусть человек скажет, что это). Для отказа возвращается ближайший
 * кандидат и чего ему не хватило — это текст подсказки в форме.
 */
export function detectEntityByHeaders(headers: readonly unknown[]): EntityDetection {
  type Scored = {
    entity: BitrixFileEntity;
    matched: number;
    resolved: ResolvedColumns<BitrixFileEntity>;
  };
  const scored: Scored[] = BITRIX_FILE_ENTITIES.map((entity) => {
    const resolved = resolveBitrixColumns(entity, headers);
    return { entity, matched: Object.keys(resolved.index).length, resolved };
  });
  const eligible = scored
    .filter((s) => s.resolved.missing.length === 0 && s.matched > 0)
    .sort((a, b) => b.matched - a.matched);
  const [best, second] = eligible;
  if (best && (!second || second.matched < best.matched)) {
    return {
      entity: best.entity,
      candidate: best.entity,
      unmatched: best.resolved.unmatched,
      missing: [],
    };
  }
  const nearest = [...scored].sort(
    (a, b) => b.matched - a.matched || a.resolved.missing.length - b.resolved.missing.length
  )[0];
  if (!nearest || nearest.matched === 0) {
    return {
      entity: null,
      candidate: null,
      unmatched: headers.map((h) => cellText(h)).filter(Boolean),
      missing: [],
    };
  }
  return {
    entity: null,
    candidate: nearest.entity,
    unmatched: nearest.resolved.unmatched,
    missing: nearest.resolved.missing,
  };
}
