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
  CONTRACT_TEMPLATE_SLOTS,
  checkSlotText,
  findSlot,
  resolveContractClauses,
  slotsForDocType,
  type ContractTemplateValues,
} from '@/lib/documents/contractTemplate';

const VALUES: ContractTemplateValues = {
  subject: 'Обучение по охране труда',
  date: '30.08.2026',
  term: 'до 31.12.2026',
  company: 'ООО «Исполнитель»',
  organization: 'ООО «Ромашка»',
  total: '15 000,00',
  inWords: 'пятнадцать тысяч рублей 00 копеек',
};

const text = (r: ReturnType<typeof resolveContractClauses>, key: string) =>
  r.clauses.find((c) => c.key === key)?.text;

describe('реестр слотов', () => {
  it('ключи уникальны, а номер пункта задан у каждого слота', () => {
    const keys = CONTRACT_TEMPLATE_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of CONTRACT_TEMPLATE_SLOTS) expect(s.clause).toMatch(/^\d+\.\d+$/);
  });

  it('во встроенных текстах нет номеров пунктов — их печатает вёрстка', () => {
    // Мутация «вернуть номер внутрь текста» ловится здесь: иначе номер
    // напечатался бы дважды.
    for (const s of CONTRACT_TEMPLATE_SLOTS) expect(s.defaultText).not.toMatch(/^\s*\d+\.\d+\./);
  });

  it('во встроенных текстах используются только объявленные подстановки', () => {
    for (const s of CONTRACT_TEMPLATE_SLOTS) {
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

describe('resolveContractClauses', () => {
  it('без своих текстов печатает встроенные и отдаёт редакцию 0', () => {
    const r = resolveContractClauses({ docType: 'contract', values: VALUES });
    expect(r.usedRevision).toBe(0);
    expect(text(r, 'subject.contract')).toBe(
      'Исполнитель обязуется оказать Заказчику услуги: Обучение по охране труда, а Заказчик — принять и оплатить их в порядке и на условиях настоящего договора.'
    );
    expect(text(r, 'term.contract')).toContain('действует до 31.12.2026');
    expect(r.sources['payment']).toBe('builtin');
  });

  it('пустой пункт «Прочие условия» не печатается — одинокий номер выглядел бы потерянным текстом', () => {
    const r = resolveContractClauses({ docType: 'contract', values: VALUES });
    expect(r.clauses.some((c) => c.key === 'misc')).toBe(false);
  });

  it('свой текст компании печатается вместо встроенного и даёт свою редакцию', () => {
    const r = resolveContractClauses({
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
    const r = resolveContractClauses({
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
    const r = resolveContractClauses({
      docType: 'contract',
      values: VALUES,
      form: { paymentTerms: 'Оплата {{amount.total}} рублей.' },
    });
    expect(text(r, 'payment')).toBe('Оплата {{amount.total}} рублей.');
  });

  it('пробелы вместо текста в форме — это «не заполнено», а не пустой абзац', () => {
    const r = resolveContractClauses({
      docType: 'contract',
      values: VALUES,
      form: { paymentTerms: '   ' },
    });
    expect(r.sources['payment']).toBe('builtin');
  });

  it('поле формы, которое слот не принимает, абзац не подменяет', () => {
    // `changeText` — поле доп. соглашения; в договоре пункт 1.1 остаётся своим.
    const r = resolveContractClauses({
      docType: 'contract',
      values: VALUES,
      form: { changeText: 'что-то поменяли' },
    });
    expect(text(r, 'subject.contract')).toContain('Исполнитель обязуется');
  });

  it('испорченная подстановка в сохранённом тексте откатывает абзац на встроенный', () => {
    // Печатать «{{чтото}}» в договоре нельзя: документ выйдет типовым, а не
    // сломанным. И редакция такого абзаца в документ не попадает.
    const r = resolveContractClauses({
      docType: 'contract',
      values: VALUES,
      overrides: new Map([['liability', { body: 'Ответственность {{нет.такого}}.', revision: 9 }]]),
    });
    expect(text(r, 'liability')).toContain('в соответствии с законодательством');
    expect(r.sources['liability']).toBe('builtin');
    expect(r.usedRevision).toBe(0);
  });

  it('доп. соглашение: свой предмет и свой срок, а порядок оплаты общий с договором', () => {
    const r = resolveContractClauses({
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
    const r = resolveContractClauses({
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
