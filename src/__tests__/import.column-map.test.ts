import { describe, it, expect } from 'vitest';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from '@/lib/services/import/column-map';

describe('column-map', () => {
  it('declares the three sheet names', () => {
    expect(SHEET_NAMES.orgs).toBeTruthy();
    expect(SHEET_NAMES.orders).toBeTruthy();
    expect(SHEET_NAMES.payments).toBeTruthy();
  });
  it('maps every DTO field to a header for each sheet', () => {
    expect(ORG_COLS.inn).toBeTruthy();
    expect(ORDER_COLS.externalId).toBeTruthy();
    expect(PAYMENT_COLS.externalId).toBeTruthy();
    expect(PAYMENT_COLS.amount).toBeTruthy();
  });
});
