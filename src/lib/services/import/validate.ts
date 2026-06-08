import { z } from 'zod';
import type { Sheet, Quarantine } from './types';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime');
const num = z.coerce.number();

const orgSchema = z.object({
  name: z.string().min(1),
  inn: z.string().min(1),
  partnerInn: z.string().nullable().default(null),
});
const orderSchema = z.object({
  externalId: z.string().min(1),
  orderNumber: z.string().nullable().default(null),
  orgInn: z.string().min(1),
  totalAmount: num,
  paidAmount: num,
});
const paymentSchema = z.object({
  externalId: z.string().min(1),
  orgInn: z.string().min(1),
  amount: num,
  paidAt: isoDate,
  method: z.string().nullable().default(null),
  isRefund: z.boolean().default(false),
  note: z.string().nullable().default(null),
});

const SCHEMAS = { orgs: orgSchema, orders: orderSchema, payments: paymentSchema } as const;

export function validateRows(sheet: Sheet, raw: unknown[]) {
  const schema = SCHEMAS[sheet];
  const valid: any[] = [];
  const quarantine: Quarantine[] = [];
  raw.forEach((row, rowIndex) => {
    const r = schema.safeParse(row);
    if (r.success) valid.push(r.data);
    else quarantine.push({ sheet, rowIndex, reason: r.error.issues[0]?.message ?? 'invalid' });
  });
  return { valid, quarantine };
}
