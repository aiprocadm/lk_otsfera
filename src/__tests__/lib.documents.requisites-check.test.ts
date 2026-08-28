import { describe, it, expect } from 'vitest';
import {
  listMissingRequisites,
  type PartyRequisites,
} from '@/lib/documents/requisites-check';
import {
  isValidBankAccount,
  isValidCorrAccount,
  isValidOgrn,
} from '@/lib/requisites/checksum';

/**
 * `У-156` (дефекты `Д-9`, `Д-10`, `Д-11`) — набор обязательных реквизитов
 * зависит от типа документа, а заполненное значение проверяется контрольной
 * суммой.
 *
 * Проверяем прежде всего запреты: договор без подписанта заказчика и счёт без
 * банковских реквизитов выпускаться не должны. До этапа 6 оба проходили.
 */
const FULL: PartyRequisites = {
  name: 'Раб',
  legalName: 'ООО «Тест»',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700132195',
  legalAddress: 'Москва',
  bankName: 'Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов',
  signerPosition: 'Директор',
  signerBasis: 'Устава',
};

const labels = (party: Partial<PartyRequisites>, other: Partial<PartyRequisites>, kind: 'invoice' | 'act' | 'contract' | 'extra_agreement') =>
  listMissingRequisites({ ...FULL, ...party }, { ...FULL, ...other }, kind).map((m) => m.label);

describe('контрольные суммы', () => {
  it('ОГРН 13 и ОГРНИП 15 — по своим делителям', () => {
    expect(isValidOgrn('1027700132195')).toBe(true);
    expect(isValidOgrn('304770000000008')).toBe(true);
    // Одна цифра испорчена — а длина та же: до этапа 6 это проходило.
    expect(isValidOgrn('1027700132190')).toBe(false);
    expect(isValidOgrn('12345678901234')).toBe(false);
  });

  it('расчётный счёт считается ПО БИК: тот же счёт с другим банком неверен', () => {
    expect(isValidBankAccount('40702810400000000005', '044525225')).toBe(true);
    expect(isValidBankAccount('40702810400000000005', '044525226')).toBe(false);
    expect(isValidBankAccount('4070281040000000000', '044525225')).toBe(false);
    expect(isValidBankAccount('40702810400000000005', '04452522')).toBe(false);
  });

  it('корсчёт считается ДРУГИМ правилом, чем расчётный', () => {
    // Настоящий корсчёт Сбербанка: правилом расчётного счёта он не проходит,
    // и проверять его тем правилом значило бы браковать верные реквизиты.
    expect(isValidCorrAccount('30101810400000000225', '044525225')).toBe(true);
    expect(isValidBankAccount('30101810400000000225', '044525225')).toBe(false);
    expect(isValidCorrAccount('30101810400000000221', '044525225')).toBe(false);
  });
});

describe('У-156: набор реквизитов зависит от типа документа', () => {
  it('полные реквизиты — пусто для всех четырёх типов', () => {
    for (const kind of ['invoice', 'act', 'contract', 'extra_agreement'] as const) {
      expect(listMissingRequisites(FULL, FULL, kind), kind).toEqual([]);
    }
  });

  it('счёт без банковских реквизитов исполнителя не выпускается', () => {
    // Счёт платят по этим цифрам — без них он бесполезен.
    const missing = labels({ bic: null, bankAccount: null }, {}, 'invoice');
    expect(missing).toContain('БИК исполнителя');
    expect(missing).toContain('р/с исполнителя');
  });

  it('договору банковские реквизиты не обязательны, а основание полномочий — да', () => {
    const contract = labels({ bic: null, bankAccount: null, signerBasis: null }, {}, 'contract');
    expect(contract).not.toContain('БИК исполнителя');
    expect(contract).toContain('основание полномочий исполнителя');
  });

  it('дефект `Д-9`: договор без подписанта заказчика больше НЕ проходит', () => {
    const contract = labels({}, { signerName: null, signerBasis: null }, 'contract');
    expect(contract).toContain('подписант заказчика (ФИО)');
    expect(contract).toContain('основание полномочий заказчика');

    // У счёта подписант заказчика не спрашивается — счёт никто не подписывает.
    expect(labels({}, { signerName: null, signerBasis: null }, 'invoice')).toEqual([]);
  });

  it('доп. соглашение проверяется как договор', () => {
    expect(labels({}, { signerBasis: null }, 'extra_agreement')).toContain(
      'основание полномочий заказчика'
    );
  });

  it('дефект `Д-10`: у счёта заказчика проверяется и КПП', () => {
    expect(labels({}, { kpp: null }, 'invoice')).toContain('КПП заказчика');
  });

  it('у ИП КПП не спрашиваем — его не существует', () => {
    // 12 цифр ИНН = предприниматель. Требовать КПП значило бы не дать
    // выставить ему счёт вообще.
    expect(labels({}, { inn: '770708389324', kpp: null }, 'invoice')).toEqual([]);
  });

  it('рабочее название заказчика закрывает отсутствие юридического', () => {
    expect(labels({}, { legalName: null, name: 'ООО Ромашка (раб.)' }, 'invoice')).toEqual([]);
    expect(labels({}, { legalName: null, name: null }, 'invoice')).toContain(
      'юр. название заказчика'
    );
  });
});

describe('У-156: заполненное, но неверное значение — тоже препятствие', () => {
  it('битый ИНН, ОГРН и счёт названы отдельными строками', () => {
    const missing = labels({ inn: '7707083890', ogrn: '1027700132190' }, {}, 'invoice');
    expect(missing).toContain('ИНН исполнителя — неверная контрольная сумма');
    expect(missing).toContain('ОГРН исполнителя — неверная контрольная сумма');

    const org = labels({}, { bankAccount: '40702810400000000001' }, 'invoice');
    expect(org).toContain('р/с заказчика не сходится с БИК');
  });

  it('счёт без БИК не считается неверным — проверять его не из чего', () => {
    expect(labels({ bic: null, bankAccount: null }, { bic: null }, 'contract')).toEqual([]);
  });
});
