import { describe, it, expect } from 'vitest';
import {
  SHEET_NAMES,
  ORG_COLS,
  ORDER_COLS,
  PAYMENT_COLS,
  REQUIRED_COLS,
} from '@/lib/services/import/column-map';

describe('column-map', () => {
  it('declares the three sheet kinds, each with alias list (Т-9)', () => {
    expect(SHEET_NAMES.orgs.length).toBeGreaterThan(0);
    expect(SHEET_NAMES.orders).toContain('Реализация товаров и услуг');
    expect(SHEET_NAMES.payments).toContain('Поступление на расчётный счёт');
  });
  it('maps every DTO field to at least one header alias', () => {
    for (const cols of [ORG_COLS, ORDER_COLS, PAYMENT_COLS]) {
      for (const aliases of Object.values(cols)) {
        expect(aliases.length).toBeGreaterThan(0);
      }
    }
  });
  it('первый алиас — основной: он показывается в диагностике и ошибках', () => {
    expect(ORDER_COLS.financialStatusRaw[0]).toBe('Статус оплаты');
    expect(PAYMENT_COLS.orderRef[0]).toBe('Заказ');
    expect(PAYMENT_COLS.purpose[0]).toBe('Назначение платежа');
    expect(PAYMENT_COLS.vatAmount[0]).toBe('НДС');
    expect(PAYMENT_COLS.paymentOrderNumber[0]).toBe('№ платёжного поручения');
  });
  it('точный вариант стоит раньше общего (первый совпавший побеждает)', () => {
    // У заказов «ИНН организации» точнее общего «ИНН» — порядок это фиксирует.
    expect(ORDER_COLS.orgInn[0]).toBe('ИНН организации');
    expect(ORDER_COLS.orgInn).toContain('ИНН');
  });
  it('обязательные колонки объявлены для каждого вида листа (Т-12)', () => {
    expect(REQUIRED_COLS.orgs).toEqual(['inn']);
    expect(REQUIRED_COLS.orders).toEqual(['externalId', 'orgInn']);
    expect(REQUIRED_COLS.payments).toEqual(['externalId', 'orgInn', 'amount', 'paidAt']);
    // Каждое обязательное поле существует в своей карте.
    for (const f of REQUIRED_COLS.orgs) expect(f in ORG_COLS).toBe(true);
    for (const f of REQUIRED_COLS.orders) expect(f in ORDER_COLS).toBe(true);
    for (const f of REQUIRED_COLS.payments) expect(f in PAYMENT_COLS).toBe(true);
  });
  it('payment map no longer has legacy note key', () => {
    expect('note' in PAYMENT_COLS).toBe(false);
  });
});
