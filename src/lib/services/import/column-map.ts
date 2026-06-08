// Russian 1C export headers → DTO field names. SAMPLE-LOCKED: confirm against
// the real export before go-live; this is the only file that changes (blast radius = 1).
export const SHEET_NAMES = {
  orgs: 'Контрагенты',
  orders: 'Реализации',
  payments: 'Поступления',
} as const;

export const ORG_COLS = {
  name: 'Наименование',
  inn: 'ИНН',
  partnerInn: 'ИНН партнёра',
} as const;

export const ORDER_COLS = {
  externalId: 'Номер',
  orderNumber: 'Номер',
  orgInn: 'ИНН организации',
  totalAmount: 'Сумма',
  paidAmount: 'Оплачено',
} as const;

export const PAYMENT_COLS = {
  externalId: 'Номер документа',
  orgInn: 'ИНН',
  amount: 'Сумма',
  paidAt: 'Дата',
  method: 'Вид операции',
  note: 'Назначение платежа',
} as const;
