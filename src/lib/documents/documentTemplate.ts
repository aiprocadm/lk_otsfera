import {
  applyPlaceholders,
  findMissingPlaceholders,
  findUnknownPlaceholders,
  type TemplatePlaceholder,
} from '@/lib/templates/placeholders';

/**
 * Тексты абзацев договора и доп. соглашения (`У-160`).
 *
 * **Зачем реестр, а не пять колонок.** Требование называет пять полей, но в
 * печати редактируемых абзацев девять: у «Предмета» и «Срока действия» тексты
 * договора и доп. соглашения разные, а «Сроки» и «Приёмка» — два отдельных
 * пункта. Реестр держит абзац единицей учёта, а экран уже собирает из них
 * группы с названиями из требования. Следующий тип документа (КП, `У-162`)
 * добавляет строки сюда и не трогает ни экран, ни печать.
 *
 * **Номер пункта — не часть текста.** До этапа 6 «2.2.» писалось внутрь
 * строки, и сотрудник, заменивший порядок оплаты своей формулировкой, ронял
 * номер: соседние пункты оставались пронумерованными, а его — нет. Номер
 * объявлен здесь постоянной величиной слота и печатается вёрсткой, поэтому
 * разъехаться он не может. Номер **постоянный, а не порядковый**: пустой
 * пункт 4.3 просто не печатается, дыры в нумерации не возникает — он
 * последний в разделе.
 *
 * **Встроенный текст живёт здесь и только здесь.** В базе хранятся ТОЛЬКО
 * отличия (`DocumentTemplate`), поэтому «вернуть стандартный» — это удаление
 * своей строки, а не запись копии: копия заморозила бы формулировку.
 */

export type DocumentTemplateDocType = 'contract' | 'extra_agreement' | 'commercial_proposal';

/** Группа полей на экране настроек — названия из `У-160`. */
export type DocumentTemplateGroup =
  | 'subject'
  | 'payment'
  | 'schedule'
  | 'liability'
  | 'term'
  | 'misc'
  | 'proposalIntro'
  | 'proposalTerms';

export const DOCUMENT_TEMPLATE_GROUPS: ReadonlyArray<{
  id: DocumentTemplateGroup;
  title: string;
  hint: string;
}> = [
  { id: 'subject', title: 'Предмет', hint: 'Что именно исполнитель обязуется сделать.' },
  { id: 'payment', title: 'Порядок оплаты', hint: 'Как и в какой срок заказчик платит.' },
  {
    id: 'schedule',
    title: 'Сроки и приёмка',
    hint: 'Как согласуются сроки и как услуги считаются принятыми.',
  },
  { id: 'liability', title: 'Ответственность', hint: 'Ответственность сторон за нарушения.' },
  {
    id: 'term',
    title: 'Срок действия',
    hint: 'С какого момента и до каких пор действует документ.',
  },
  {
    id: 'misc',
    title: 'Прочие условия',
    hint: 'Дополнительный пункт договора. Пока поле пустое — он не печатается.',
  },
  // `У-162` (этап 7). Группы КП идут ПОСЛЕ договорных: экран рисует группы в
  // этом порядке, а договор в компании правят чаще, чем предложение.
  {
    id: 'proposalIntro',
    title: 'Вводный текст предложения',
    hint: 'Первые строки коммерческого предложения — обращение к клиенту перед таблицей с ценами.',
  },
  {
    id: 'proposalTerms',
    title: 'Условия предложения',
    hint: 'Что написано под таблицей: до какого числа действует цена и что делать дальше.',
  },
];

/** Поля формы выпуска, которые заменяют абзац ЦЕЛИКОМ (`У-147`). */
export type DocumentTemplateFormInput = {
  /** «Порядок оплаты» — разовая замена пункта 2.2 на один документ. */
  paymentTerms?: string | null;
  /** «Что меняется» — разовая замена пункта 1.1 доп. соглашения. */
  changeText?: string | null;
};

export type DocumentTemplateSlot = {
  /** Ключ строки в базе. */
  key: string;
  group: DocumentTemplateGroup;
  /** Номер пункта в печати — постоянная величина, не считается по позиции. */
  clause: string;
  /** Где печатается — показывается рядом с полем. */
  where: string;
  /** В каких документах печатается этот абзац. */
  docTypes: readonly DocumentTemplateDocType[];
  /** Допустимые подстановки. Всё остальное — отказ сохранить. */
  placeholders: readonly TemplatePlaceholder[];
  /** Подстановки, без которых текст теряет смысл. */
  required: readonly string[];
  /** Поле формы выпуска, заменяющее абзац целиком; `null` — замены нет. */
  formField: keyof DocumentTemplateFormInput | null;
  /** Встроенный текст — то, что печатается сегодня. Пустой = пункт не печатается. */
  defaultText: string;
};

const P = {
  subject: { token: 'document.subject', prop: 'subject', label: 'Предмет документа' },
  date: { token: 'document.date', prop: 'date', label: 'Дата документа' },
  term: { token: 'contract.term', prop: 'term', label: 'Срок действия' },
  company: { token: 'company.name', prop: 'company', label: 'Название исполнителя' },
  organization: { token: 'organization.name', prop: 'organization', label: 'Название заказчика' },
  total: { token: 'amount.total', prop: 'total', label: 'Сумма цифрами' },
  inWords: { token: 'amount.inWords', prop: 'inWords', label: 'Сумма прописью' },
  // `У-162`: срок действия КП — ДАТА, а не текст пункта, как `contract.term`
  // у договора. Разные подстановки нарочно: подставить одну вместо другой
  // означало бы напечатать «до 15.09.2026» там, где ждут «один год».
  validUntil: {
    token: 'proposal.validUntil',
    prop: 'validUntil',
    label: 'Предложение действительно до',
  },
} as const satisfies Record<string, TemplatePlaceholder>;

/** Подстановки, доступные почти везде: стороны, суммы, дата и предмет. */
const COMMON: readonly TemplatePlaceholder[] = [
  P.subject,
  P.date,
  P.company,
  P.organization,
  P.total,
  P.inWords,
];

const BOTH: readonly DocumentTemplateDocType[] = ['contract', 'extra_agreement'];

/**
 * Порядок здесь — порядок печати внутри документа.
 *
 * Раздельные слоты заведены ТОЛЬКО там, где печать различается уже сегодня
 * («Предмет» и «Срок действия»). Всё остальное общее: если бы порядок оплаты
 * правился отдельно для договора, доп. соглашение к той же сделке продолжало
 * бы печатать прежнюю формулировку — две бумаги одной сделки говорили бы
 * разное, и заметил бы это юрист заказчика, а не мы.
 */
export const DOCUMENT_TEMPLATE_SLOTS: readonly DocumentTemplateSlot[] = [
  {
    key: 'subject.contract',
    group: 'subject',
    clause: '1.1',
    where: 'Договор, раздел 1 «Предмет»',
    docTypes: ['contract'],
    placeholders: COMMON,
    required: [],
    // Поле формы «Предмет договора» подставляется ВНУТРЬ этого предложения
    // подстановкой, а не заменяет его: заменив, мы стёрли бы обязательство
    // сторон и оставили в договоре три слова названия услуги.
    formField: null,
    defaultText:
      'Исполнитель обязуется оказать Заказчику услуги: {{document.subject}}, а Заказчик — принять и оплатить их в порядке и на условиях настоящего договора.',
  },
  {
    key: 'subject.extra',
    group: 'subject',
    clause: '1.1',
    where: 'Доп. соглашение, раздел 1 «Предмет»',
    docTypes: ['extra_agreement'],
    placeholders: COMMON,
    required: [],
    formField: 'changeText',
    defaultText:
      'Стороны договорились изложить условия оказания услуг по договору в следующей редакции: {{document.subject}}.',
  },
  {
    key: 'payment',
    group: 'payment',
    clause: '2.2',
    where: 'Раздел 2 «Цена и порядок расчётов»',
    docTypes: BOTH,
    placeholders: COMMON,
    required: [],
    formField: 'paymentTerms',
    defaultText:
      'Оплата производится в безналичном порядке на расчётный счёт Исполнителя на основании выставленного счёта в течение 5 (пяти) рабочих дней с даты его получения.',
  },
  {
    key: 'deadline',
    group: 'schedule',
    clause: '3.1',
    where: 'Раздел 3 «Сроки и порядок сдачи-приёмки»',
    docTypes: BOTH,
    placeholders: COMMON,
    required: [],
    formField: null,
    defaultText:
      'Сроки оказания услуг согласовываются Сторонами и фиксируются в личном кабинете Заказчика.',
  },
  {
    key: 'acceptance',
    group: 'schedule',
    clause: '3.2',
    where: 'Раздел 3 «Сроки и порядок сдачи-приёмки»',
    docTypes: BOTH,
    placeholders: COMMON,
    required: [],
    formField: null,
    defaultText:
      'По завершении оказания услуг Исполнитель передаёт Заказчику акт. При отсутствии мотивированных возражений в течение 5 (пяти) рабочих дней услуги считаются принятыми.',
  },
  {
    key: 'liability',
    group: 'liability',
    clause: '4.1',
    where: 'Раздел 4 «Ответственность и прочие условия»',
    docTypes: BOTH,
    placeholders: COMMON,
    required: [],
    formField: null,
    defaultText:
      'За неисполнение обязательств Стороны несут ответственность в соответствии с законодательством Российской Федерации.',
  },
  {
    key: 'term.contract',
    group: 'term',
    clause: '4.2',
    where: 'Договор, раздел 4 «Ответственность и прочие условия»',
    docTypes: ['contract'],
    placeholders: [...COMMON, P.term],
    // Срок действия печатается ровно в этом абзаце и больше нигде. Текст без
    // подстановки молча превратил бы срочный договор в бессрочный, поэтому
    // сохранить такой текст нельзя.
    required: [P.term.token],
    formField: null,
    defaultText:
      'Договор вступает в силу с даты подписания и действует {{contract.term}}. Документы, направленные через личный кабинет, признаются юридически значимыми.',
  },
  {
    key: 'term.extra',
    group: 'term',
    clause: '4.2',
    where: 'Доп. соглашение, раздел 4',
    docTypes: ['extra_agreement'],
    placeholders: COMMON,
    required: [],
    formField: null,
    defaultText:
      'Остальные условия договора остаются без изменений. Настоящее соглашение является его неотъемлемой частью и вступает в силу с даты подписания.',
  },
  {
    key: 'misc',
    group: 'misc',
    clause: '4.3',
    where: 'Договор, раздел 4 «Ответственность и прочие условия»',
    // Доп. соглашение и так говорит «остальные условия остаются без
    // изменений»: дописать туда новые условия — напечатать бумагу, спорящую
    // сама с собой.
    docTypes: ['contract'],
    placeholders: COMMON,
    required: [],
    formField: null,
    // Готового текста под это поле в договоре нет. Сочинять за юриста
    // формулировку мы не станем: пустой пункт честнее выдуманного.
    defaultText: '',
  },

  /**
   * Коммерческое предложение (`У-162`, этап 7). Два абзаца, и оба без номера
   * пункта: КП — не договор, нумерованных разделов у него нет. Пустая строка
   * `clause` здесь означает ровно это, а вёрстка КП печатает текст как есть.
   */
  {
    key: 'proposal.intro',
    group: 'proposalIntro',
    clause: '',
    where: 'Коммерческое предложение, первые строки — перед таблицей',
    docTypes: ['commercial_proposal'],
    placeholders: [...COMMON, P.validUntil],
    required: [],
    formField: null,
    defaultText:
      'Здравствуйте! Благодарим за интерес к нашим услугам. Направляем коммерческое предложение по вашему запросу: {{document.subject}}. Ниже — состав работ и стоимость.',
  },
  {
    key: 'proposal.terms',
    group: 'proposalTerms',
    clause: '',
    where: 'Коммерческое предложение, под таблицей с ценами',
    docTypes: ['commercial_proposal'],
    placeholders: [...COMMON, P.validUntil],
    // Срок обязателен: предложение без даты «до когда» — это не предложение,
    // а прайс-лист. Проверка сохранения не даст его выкинуть.
    required: [P.validUntil.token],
    formField: null,
    defaultText:
      'Предложение действительно до {{proposal.validUntil}}. Стоимость указана в рублях. Чтобы начать, ответьте на это письмо — мы подготовим договор и счёт.',
  },
];

export function slotsForDocType(docType: DocumentTemplateDocType): DocumentTemplateSlot[] {
  return DOCUMENT_TEMPLATE_SLOTS.filter((s) => s.docTypes.includes(docType));
}

export function findSlot(key: string): DocumentTemplateSlot | undefined {
  return DOCUMENT_TEMPLATE_SLOTS.find((s) => s.key === key);
}

/** Значения подстановок — готовыми строками; форматирует вызывающий. */
export type DocumentTemplateValues = {
  subject: string;
  date: string;
  term: string;
  company: string;
  organization: string;
  total: string;
  inWords: string;
  /** `У-162`: до какой даты действует КП. У договора не используется. */
  validUntil: string;
};

/** Свой текст компании: тело абзаца и номер редакции, которым его записали. */
export type DocumentTemplateOverride = { body: string; revision: number };

/** Откуда взялся напечатанный абзац — идёт в журнал действий, без текстов. */
type ClauseSource = 'form' | 'template' | 'builtin';

export type ResolvedClause = { key: string; clause: string; text: string };

export type ResolvedClauses = {
  /** Абзацы в порядке печати; пустые пропущены. */
  clauses: ResolvedClause[];
  /**
   * Что писать в `Document.templateVersion`: наибольший номер редакции среди
   * абзацев, которые РЕАЛЬНО напечатаны текстом компании. `0` — ни одного,
   * то есть документ напечатан встроенным текстом.
   */
  usedRevision: number;
  sources: Record<string, ClauseSource>;
};

/**
 * Собрать абзацы документа. Чистая функция: ни базы, ни вёрстки — поэтому её
 * зовут и предпросмотр, и выпуск, и разойтись они не могут.
 *
 * Приоритет объявлен ПОСЛОТНО, а не общим правилом «форма важнее всего»:
 * замену целым абзацем допускают только «Порядок оплаты» и «Что меняется»,
 * потому что остальные поля формы — это значения ВНУТРИ предложения.
 *
 * Текст, набранный человеком в форме, печатается дословно и через подстановки
 * НЕ прогоняется: `{{` в разовой правке — это то, что человек написал, а не
 * команда шаблонизатора.
 */
export function resolveDocumentClauses(input: {
  docType: DocumentTemplateDocType;
  values: DocumentTemplateValues;
  overrides?: ReadonlyMap<string, DocumentTemplateOverride>;
  form?: DocumentTemplateFormInput;
}): ResolvedClauses {
  const { docType, values, overrides, form } = input;
  const clauses: ResolvedClause[] = [];
  const sources: Record<string, ClauseSource> = {};
  let usedRevision = 0;

  for (const slot of slotsForDocType(docType)) {
    const fromForm = slot.formField ? form?.[slot.formField]?.trim() : undefined;
    if (fromForm) {
      clauses.push({ key: slot.key, clause: slot.clause, text: fromForm });
      sources[slot.key] = 'form';
      continue;
    }

    const override = overrides?.get(slot.key);
    // Реестр подстановок мог измениться после того, как текст сохранили:
    // печатать «{{чтото}}» в договоре нельзя, поэтому такой абзац откатывается
    // на встроенный — документ выйдет типовым, а не сломанным.
    const usable =
      override &&
      findUnknownPlaceholders(
        slot.placeholders.map((p) => p.token),
        override.body
      ).ok
        ? override
        : null;

    const body = usable ? usable.body : slot.defaultText;
    if (usable) {
      sources[slot.key] = 'template';
      usedRevision = Math.max(usedRevision, usable.revision);
    } else {
      sources[slot.key] = 'builtin';
    }

    const text = applyPlaceholders(body, placeholderValues(slot, values)).trim();
    // Пустой абзац не печатается: одинокий номер пункта посреди договора
    // выглядит как потерянный текст.
    if (text) clauses.push({ key: slot.key, clause: slot.clause, text });
  }

  return { clauses, usedRevision, sources };
}

function placeholderValues(
  slot: DocumentTemplateSlot,
  values: DocumentTemplateValues
): Map<string, string> {
  return new Map(
    slot.placeholders.map((p) => [p.token, values[p.prop as keyof DocumentTemplateValues]])
  );
}

export type SlotTextCheck =
  | { ok: true }
  | { ok: false; error: 'unknown_placeholder'; tokens: string[] }
  | { ok: false; error: 'missing_placeholder'; tokens: string[] };

/**
 * Проверка текста абзаца перед сохранением — та же, что перед показом
 * предпросмотра: «показать» не должно работать там, где «сохранить» откажет.
 */
export function checkSlotText(slot: DocumentTemplateSlot, body: string): SlotTextCheck {
  const unknown = findUnknownPlaceholders(
    slot.placeholders.map((p) => p.token),
    body
  );
  if (!unknown.ok) return { ok: false, error: 'unknown_placeholder', tokens: unknown.unknown };
  const missing = findMissingPlaceholders(slot.required, body);
  if (!missing.ok) return { ok: false, error: 'missing_placeholder', tokens: missing.missing };
  return { ok: true };
}
