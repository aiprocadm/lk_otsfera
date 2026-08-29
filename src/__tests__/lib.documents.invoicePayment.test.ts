import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATE_LABELS,
  invoicePaymentState,
  referencedInvoiceNumbers,
  type InvoicePaymentPayment,
} from '@/lib/documents/invoicePayment';

/**
 * `У-148` — признак оплаты счёта.
 *
 * Признак **вычисляемый**: руками его никто не ставит (`У-150` прямо
 * запрещает кнопку «Оплачено» у заказчика). Значит, единственный источник
 * правды — платежи заказа, а связь «платёж → счёт» берётся из назначения
 * платежа. Проверяем не только «сошлось», но и «не сошлось»: молчаливое
 * «оплачен» на чужом платеже хуже, чем честное «не удалось сопоставить».
 */

function pay(purpose: string | null, amount: string, extra: Partial<InvoicePaymentPayment> = {}) {
  return { amount, purpose, note: null, isRefund: false, ...extra };
}

describe('признак оплаты счёта', () => {
  it('без номера или без суммы признак не считается', () => {
    // Документы, выпущенные до этапа 6, суммы не имеют (`У-146` запрещает
    // бэкфилл). Показывать по ним «не оплачен» — выдумывать факт.
    expect(invoicePaymentState({ number: null, amountGross: '1000', payments: [] })).toBeNull();
    expect(
      invoicePaymentState({ number: 'С-2026-17', amountGross: null, payments: [] })
    ).toBeNull();
  });

  it('платёж со ссылкой на номер счёта закрывает его полностью', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Оплата по счёту С-2026-17 от 20.08.2026, в т.ч. НДС', '12000.00')],
    });
    expect(res).toEqual({ state: 'paid', paid: 12000, matched: true, ambiguous: false });
  });

  it('часть суммы — «оплачен частично»', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Аванс по счету С-2026-17', '5000.00')],
    });
    expect(res?.state).toBe('partially_paid');
    expect(res?.paid).toBe(5000);
  });

  it('переплата — всё равно «оплачен», а не «частично»', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Оплата по счёту С-2026-17', '12500.00')],
    });
    expect(res?.state).toBe('paid');
  });

  it('возврат уменьшает зачтённое', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [
        pay('Оплата по счёту С-2026-17', '12000.00'),
        pay('Возврат по счёту С-2026-17', '12000.00', { isRefund: true }),
      ],
    });
    expect(res).toEqual({ state: 'unpaid', paid: 0, matched: true, ambiguous: false });
  });

  it('чужой счёт в назначении не засчитывается', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Оплата по счёту С-2026-99', '12000.00')],
    });
    expect(res).toEqual({ state: 'unpaid', paid: 0, matched: false, ambiguous: false });
  });

  it('платёж без номера в назначении не приписывается счёту', () => {
    // Деньги по заказу пришли, но к какому счёту — неизвестно. Это «не
    // удалось сопоставить», а не «оплачен».
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Оплата по договору', '12000.00')],
    });
    expect(res?.matched).toBe(false);
    expect(res?.state).toBe('unpaid');
  });

  it('назначение с двумя разными счетами — неоднозначность, деньги не зачитываются', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Оплата по счетам С-2026-17 и счёт С-2026-18', '24000.00')],
    });
    expect(res).toEqual({ state: 'unpaid', paid: 0, matched: false, ambiguous: true });
  });

  it('латинская C вместо русской С в назначении — тот же счёт', () => {
    // Номер печатается кириллицей, а в банковской выписке приходит латиницей.
    // Человек видит одинаковые буквы, программа — разные символы.
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '12000.00',
      payments: [pay('Oплата по счету C-2026-17', '12000.00')],
    });
    expect(res?.state).toBe('paid');
    expect(res?.matched).toBe(true);
  });

  it('регистр и лишние пробелы в номере не мешают', () => {
    const res = invoicePaymentState({
      number: ' с-2026-17 ',
      amountGross: '12000.00',
      payments: [pay('ОПЛАТА ПО СЧЁТУ С-2026-17', '12000.00')],
    });
    expect(res?.state).toBe('paid');
  });

  it('номер ищется и в примечании, когда назначение пустое', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '1000.00',
      payments: [pay(null, '1000.00', { note: 'оплата по счёту С-2026-17' })],
    });
    expect(res?.state).toBe('paid');
  });

  it('платежей нет — «не оплачен», и сопоставлять было нечего', () => {
    const res = invoicePaymentState({ number: 'С-2026-17', amountGross: '1000', payments: [] });
    expect(res).toEqual({ state: 'unpaid', paid: 0, matched: false, ambiguous: false });
  });

  it('«счёт получателя» — не номер: без цифр кандидата нет', () => {
    // Иначе слово после «счёт» само стало бы номером, и платёж приписался бы
    // случайному счёту.
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '1000.00',
      payments: [pay('Оплата на счёт получателя по договору', '1000.00')],
    });
    expect(res?.matched).toBe(false);
  });

  it('номер, названный в платеже дважды, остаётся одним счётом', () => {
    // Повтор в тексте («по счёту С-2026-17, счёт С-2026-17») — это НЕ два
    // разных счёта, и неоднозначностью считаться не должен.
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: '1000.00',
      payments: [pay('Оплата по счёту С-2026-17, счёт С-2026-17', '1000.00')],
    });
    expect(res).toEqual({ state: 'paid', paid: 1000, matched: true, ambiguous: false });
  });

  it('пустой номер равносилен отсутствию номера', () => {
    expect(invoicePaymentState({ number: '   ', amountGross: '1000', payments: [] })).toBeNull();
  });

  it('суммы принимаются и числом, а не только строкой', () => {
    const res = invoicePaymentState({
      number: 'С-2026-17',
      amountGross: 1000,
      payments: [{ amount: 1000, isRefund: false, purpose: 'по счёту С-2026-17', note: null }],
    });
    expect(res?.state).toBe('paid');
  });

  it('пустое назначение платежа не даёт кандидатов', () => {
    expect(referencedInvoiceNumbers(null)).toEqual([]);
    expect(referencedInvoiceNumbers('')).toEqual([]);
  });

  it('у каждого состояния есть русское название', () => {
    expect(PAYMENT_STATE_LABELS.unpaid).toBe('Не оплачен');
    expect(PAYMENT_STATE_LABELS.partially_paid).toBe('Оплачен частично');
    expect(PAYMENT_STATE_LABELS.paid).toBe('Оплачен');
  });
});
