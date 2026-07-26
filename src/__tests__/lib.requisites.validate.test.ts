import { describe, it, expect } from 'vitest';
import { validateRequisites } from '@/lib/requisites/validate';

// Этап 8 (PR-1) — чистая валидация реквизитов: опциональность + строгий формат заполненного.
describe('validateRequisites', () => {
  it('пустой ввод валиден (реквизиты заполняются постепенно) — все значения null', () => {
    const r = validateRequisites({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.inn).toBeNull();
      expect(r.values.signerBasis).toBeNull();
    }
  });

  it('нормализация: trim, пустые строки → null, цифровые поля чистятся от пробелов/дефисов', () => {
    const r = validateRequisites({
      legalName: '  ООО «Ромашка»  ',
      inn: ' 7707-083893 ',
      bic: '04 452 5225',
      bankAccount: '4070 2810 4000 0000 0001',
      kpp: '',
      signerName: '   '
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.legalName).toBe('ООО «Ромашка»');
      expect(r.values.inn).toBe('7707083893');
      expect(r.values.bic).toBe('044525225');
      expect(r.values.bankAccount).toBe('40702810400000000001');
      expect(r.values.kpp).toBeNull();
      expect(r.values.signerName).toBeNull();
    }
  });

  it.each([
    [{ inn: '123' }, 'ИНН'],
    [{ inn: '12345678901' }, 'ИНН'],
    [{ kpp: '12345' }, 'КПП'],
    [{ ogrn: '1234' }, 'ОГРН'],
    [{ ogrn: '12345678901234' }, 'ОГРН'],
    [{ bic: '12345678' }, 'БИК'],
    [{ bankAccount: '123' }, 'Расчётный'],
    [{ corrAccount: '1234567890123456789' }, 'Корреспондентский']
  ])('неверный формат %j → ошибка с «%s»', (input, word) => {
    const r = validateRequisites(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain(word);
  });

  it('валидные форматы проходят: ИНН 10/12, ОГРН 13/15, счета 20', () => {
    for (const input of [
      { inn: '7707083893' },
      { inn: '770708389301' },
      { ogrn: '1027700132195' },
      { ogrn: '304770000000000' },
      { corrAccount: '30101810400000000225' }
    ]) {
      expect(validateRequisites(input).ok).toBe(true);
    }
  });

  it('сверхдлинный текст → ошибка с названием поля; несколько ошибок копятся', () => {
    const r = validateRequisites({ legalName: 'x'.repeat(301), inn: '1', bic: '2' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBe(3);
      expect(r.errors.join(' ')).toContain('Юридическое название');
    }
  });
});
