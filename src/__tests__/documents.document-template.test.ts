/**
 * Реестр абзацев договора и сборка текста (`У-160`, этап 6 PR-7).
 *
 * Здесь проверяется то, из-за чего документ уезжает клиенту неверным:
 * приоритет «форма → свой текст → встроенный», номера пунктов, откат на
 * встроенный текст при испорченной подстановке и число, которое попадёт в
 * `Document.templateVersion`.
 */
import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_TEMPLATE_SLOTS,
  checkSlotText,
  findSlot,
  resolveDocumentClauses,
  slotsForDocType,
  type DocumentTemplateValues,
} from '@/lib/documents/documentTemplate';

const VALUES: DocumentTemplateValues = {
  subject: 'Обучение по охране труда',
  date: '30.08.2026',
  term: 'до 31.12.2026',
  company: 'ООО «Исполнитель»',
  organization: 'ООО «Ромашка»',
  total: '15 000,00',
  inWords: 'пятнадцать тысяч рублей 00 копеек',
  validUntil: '15.09.2026',
};

const text = (r: ReturnType<typeof resolveDocumentClauses>, key: string) =>
  r.clauses.find((c) => c.key === key)?.text;

describe('реестр слотов', () => {
  it('ключи уникальны, а номер пункта задан у каждого договорного слота', () => {
    const keys = DOCUMENT_TEMPLATE_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of DOCUMENT_TEMPLATE_SLOTS) {
      // У коммерческого предложения нумерованных разделов нет вовсе (`У-162`),
      // поэтому номер пункта у его слотов ПУСТОЙ — и это не пропуск, а
      // единственно честное значение: выдуманный «1.1» в письме с ценой
      // сделал бы вид, что это договор.
      if (s.docTypes.includes('commercial_proposal')) {
        expect(s.clause, s.key).toBe('');
        continue;
      }
      expect(s.clause, s.key).toMatch(/^\d+\.\d+$/);
    }
  });

  it('слот принадлежит либо договорным типам, либо КП — смешения нет', () => {
    // Слот с номером пункта, попавший заодно в КП, напечатался бы там без
    // номера и потерял бы смысл; слот КП в договоре — наоборот, оказался бы
    // ненумерованным абзацем посреди нумерованных.
    for (const s of DOCUMENT_TEMPLATE_SLOTS) {
      const proposal = s.docTypes.includes('commercial_proposal');
      const contract = s.docTypes.some((t) => t !== 'commercial_proposal');
      expect(proposal && contract, `${s.key} печатается и там, и там`).toBe(false);
    }
  });

  it('во встроенных текстах нет номеров пунктов — их печатает вёрстка', () => {
    // Мутация «вернуть номер внутрь текста» ловится здесь: иначе номер
    // напечатался бы дважды.
    for (const s of DOCUMENT_TEMPLATE_SLOTS) expect(s.defaultText).not.toMatch(/^\s*\d+\.\d+\./);
  });

  it('во встроенных текстах используются только объявленные подстановки', () => {
    for (const s of DOCUMENT_TEMPLATE_SLOTS) {
      expect(checkSlotText(s, s.defaultText || 'непустой текст')).toEqual({ ok: true });
    }
  });

  it('состав слотов зависит от типа документа', () => {
    const contract = slotsForDocType('contract').map((s) => s.key);
    const extra = slotsForDocType('extra_agreement').map((s) => s.key);
    expect(contract).toContain('subject.contract');
    expect(contract).toContain('misc');
    expect(extra).toContain('subject.extra');
    // `У-160`: «прочие условия» в доп. соглашении не печатаются — оно и так
    // говорит «остальные условия остаются без изменений».
    expect(extra).not.toContain('misc');
    expect(extra).not.toContain('term.contract');
  });

  it('несуществующий ключ слота не находится', () => {
    expect(findSlot('нет-такого')).toBeUndefined();
    expect(findSlot('payment')?.clause).toBe('2.2');
  });
});

describe('resolveDocumentClauses', () => {
  it('без своих текстов печатает встроенные и отдаёт редакцию 0', () => {
    const r = resolveDocumentClauses({ docType: 'contract', values: VALUES });
    expect(r.usedRevision).toBe(0);
    expect(text(r, 'subject.contract')).toBe(
      'Исполнитель обязуется оказать Заказчику услуги: Обучение по охране труда, а Заказчик — принять и оплатить их в порядке и на условиях настоящего договора.'
    );
    expect(text(r, 'term.contract')).toContain('действует до 31.12.2026');
    expect(r.sources['payment']).toBe('builtin');
  });

  it('пустой пункт «Прочие условия» не печатается — одинокий номер выглядел бы потерянным текстом', () => {
    const r = resolveDocumentClauses({ docType: 'contract', values: VALUES });
    expect(r.clauses.some((c) => c.key === 'misc')).toBe(false);
  });

  it('свой текст компании печатается вместо встроенного и даёт свою редакцию', () => {
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      overrides: new Map([
        ['payment', { body: 'Оплата 100% предоплатой.', revision: 7 }],
        ['liability', { body: 'Стороны отвечают по закону.', revision: 3 }],
      ]),
    });
    expect(text(r, 'payment')).toBe('Оплата 100% предоплатой.');
    // Редакция документа — НАИБОЛЬШИЙ штамп среди применённых абзацев.
    expect(r.usedRevision).toBe(7);
    expect(r.sources['payment']).toBe('template');
    expect(r.sources['deadline']).toBe('builtin');
  });

  it('поле формы заменяет абзац целиком и в редакцию не попадает', () => {
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      overrides: new Map([['payment', { body: 'Текст компании', revision: 5 }]]),
      form: { paymentTerms: 'Оплата по факту, 10 дней.' },
    });
    expect(text(r, 'payment')).toBe('Оплата по факту, 10 дней.');
    expect(r.sources['payment']).toBe('form');
    // Абзац напечатан не шаблоном — номер редакции не должен приписывать
    // шаблону чужую работу.
    expect(r.usedRevision).toBe(0);
  });

  it('текст из формы печатается дословно: подстановки в нём не раскрываются', () => {
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      form: { paymentTerms: 'Оплата {{amount.total}} рублей.' },
    });
    expect(text(r, 'payment')).toBe('Оплата {{amount.total}} рублей.');
  });

  it('пробелы вместо текста в форме — это «не заполнено», а не пустой абзац', () => {
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      form: { paymentTerms: '   ' },
    });
    expect(r.sources['payment']).toBe('builtin');
  });

  it('поле формы, которое слот не принимает, абзац не подменяет', () => {
    // `changeText` — поле доп. соглашения; в договоре пункт 1.1 остаётся своим.
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      form: { changeText: 'что-то поменяли' },
    });
    expect(text(r, 'subject.contract')).toContain('Исполнитель обязуется');
  });

  it('испорченная подстановка в сохранённом тексте откатывает абзац на встроенный', () => {
    // Печатать «{{чтото}}» в договоре нельзя: документ выйдет типовым, а не
    // сломанным. И редакция такого абзаца в документ не попадает.
    const r = resolveDocumentClauses({
      docType: 'contract',
      values: VALUES,
      overrides: new Map([['liability', { body: 'Ответственность {{нет.такого}}.', revision: 9 }]]),
    });
    expect(text(r, 'liability')).toContain('в соответствии с законодательством');
    expect(r.sources['liability']).toBe('builtin');
    expect(r.usedRevision).toBe(0);
  });

  it('доп. соглашение: свой предмет и свой срок, а порядок оплаты общий с договором', () => {
    const r = resolveDocumentClauses({
      docType: 'extra_agreement',
      values: VALUES,
      overrides: new Map([['payment', { body: 'Общий текст оплаты.', revision: 2 }]]),
    });
    expect(text(r, 'subject.extra')).toContain('изложить условия оказания услуг');
    expect(text(r, 'term.extra')).toContain('Остальные условия договора остаются без изменений');
    expect(text(r, 'payment')).toBe('Общий текст оплаты.');
    expect(text(r, 'term.contract')).toBeUndefined();
  });

  it('«что меняется» из формы заменяет пункт 1.1 доп. соглашения', () => {
    const r = resolveDocumentClauses({
      docType: 'extra_agreement',
      values: VALUES,
      form: { changeText: '3.2. изложить в редакции: срок продлён.' },
    });
    // Ведущий номер НЕ срезается: в доп. соглашении это ссылка на изменяемый
    // пункт основного договора — вырезав её, мы вырежем самое главное.
    expect(text(r, 'subject.extra')).toBe('3.2. изложить в редакции: срок продлён.');
  });
});

describe('checkSlotText', () => {
  const payment = findSlot('payment')!;
  const term = findSlot('term.contract')!;

  it('неизвестная подстановка — отказ с перечнем', () => {
    expect(checkSlotText(payment, 'Оплата {{нет.такого}}')).toEqual({
      ok: false,
      error: 'unknown_placeholder',
      tokens: ['нет.такого'],
    });
  });

  it('потерянная обязательная подстановка — отказ', () => {
    // Срок действия печатается ровно в этом абзаце: текст без него молча
    // превратил бы срочный договор в бессрочный.
    expect(checkSlotText(term, 'Договор действует бессрочно.')).toEqual({
      ok: false,
      error: 'missing_placeholder',
      tokens: ['contract.term'],
    });
  });

  it('срок действия недоступен там, где его нет в списке слота', () => {
    expect(checkSlotText(payment, 'Оплата {{contract.term}}')).toMatchObject({
      ok: false,
      error: 'unknown_placeholder',
    });
  });

  it('корректный текст проходит', () => {
    expect(checkSlotText(term, 'Действует {{contract.term}}.')).toEqual({ ok: true });
  });
});

/**
 * Коммерческое предложение (`У-162`, этап 7). У него свои два абзаца, своя
 * подстановка «срок действия» и НЕТ номеров пунктов.
 */
describe('слоты коммерческого предложения', () => {
  const slots = slotsForDocType('commercial_proposal');

  it('у КП ровно два абзаца — вводный текст и условия', () => {
    expect(slots.map((s) => s.key)).toEqual(['proposal.intro', 'proposal.terms']);
  });

  it('договорные абзацы в КП не печатаются, и наоборот', () => {
    // Иначе в письме с ценой оказался бы пункт «Ответственность Сторон», а в
    // договоре — «Чтобы начать, ответьте на это письмо».
    const contractKeys = slotsForDocType('contract').map((s) => s.key);
    expect(contractKeys).not.toContain('proposal.intro');
    expect(slots.map((s) => s.key)).not.toContain('payment');
  });

  it('срок действия подставляется ДАТОЙ, а не куском фразы договора', () => {
    // `contract.term` печатает «до полного исполнения обязательств»;
    // `proposal.validUntil` — «15.09.2026». Перепутать их значит напечатать в
    // предложении срок, по которому непонятно, до какого числа держится цена.
    const r = resolveDocumentClauses({ docType: 'commercial_proposal', values: VALUES });
    expect(text(r, 'proposal.terms')).toContain('15.09.2026');
    expect(text(r, 'proposal.terms')).not.toContain('до 31.12.2026');
  });

  it('вводный текст подставляет предмет предложения', () => {
    const r = resolveDocumentClauses({ docType: 'commercial_proposal', values: VALUES });
    expect(text(r, 'proposal.intro')).toContain('Обучение по охране труда');
  });

  it('свой текст компании печатается вместо встроенного и поднимает редакцию', () => {
    const r = resolveDocumentClauses({
      docType: 'commercial_proposal',
      values: VALUES,
      overrides: new Map([
        ['proposal.terms', { body: 'Цена держится до {{proposal.validUntil}}.', revision: 4 }],
      ]),
    });
    expect(text(r, 'proposal.terms')).toBe('Цена держится до 15.09.2026.');
    expect(r.usedRevision).toBe(4);
  });

  it('условия без срока сохранить нельзя: предложение без даты — это прайс-лист', () => {
    const terms = slots.find((s) => s.key === 'proposal.terms')!;
    expect(checkSlotText(terms, 'Звоните, договоримся.')).toEqual({
      ok: false,
      error: 'missing_placeholder',
      tokens: ['proposal.validUntil'],
    });
    expect(checkSlotText(terms, 'Цена держится до {{proposal.validUntil}}.')).toEqual({ ok: true });
  });

  it('подстановки договора в тексте КП не принимаются', () => {
    const intro = slots.find((s) => s.key === 'proposal.intro')!;
    expect(checkSlotText(intro, 'Договор действует {{contract.term}}')).toMatchObject({
      ok: false,
      error: 'unknown_placeholder',
    });
  });

  it('номера пункта у абзацев КП нет — вёрстке нечего печатать перед текстом', () => {
    for (const slot of slots) expect(slot.clause, slot.key).toBe('');
  });
});
