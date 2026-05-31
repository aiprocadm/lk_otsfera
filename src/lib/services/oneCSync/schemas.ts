import { z } from 'zod';

// Accepts anything Date.parse understands; rejects garbage. Tightening to a strict
// format is DECISION Q7 (datetime format from 1C) — keep permissive until confirmed.
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid datetime' });

export const OneCOrgSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  legalName: z.string().optional(),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  partnerExternalId: z.string().optional(),
  updatedAt: isoDate
});

export const OneCOrderSchema = z.object({
  externalId: z.string().min(1),
  orderNumber: z.string().optional(),
  title: z.string().min(1),
  organizationExternalId: z.string().min(1),
  totalAmount: z.number(),
  paidAmount: z.number(),
  paidAt: isoDate.optional(),
  contractSignedAt: isoDate.optional(),
  completedAt: isoDate.optional(),
  closedAt: isoDate.optional(),
  vatIncluded: z.boolean(),
  vatRate: z.number().optional(),
  executionStatus: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'on_hold']),
  financialStatus: z.enum(['not_billed', 'billed', 'partially_paid', 'paid', 'refunded']),
  productMix: z.array(z.string()),
  updatedAt: isoDate
});

export const OneCPaymentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1),
  amount: z.number(),
  paidAt: isoDate,
  method: z.string().optional(),
  isRefund: z.boolean(),
  updatedAt: isoDate
});

export const OneCDocumentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1),
  type: z.enum(['contract', 'extra_agreement', 'invoice', 'act', 'waybill', 'certificate', 'report', 'other']),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number(),
  signedAt: isoDate.optional(),
  downloadUrl: z.string().min(1),
  updatedAt: isoDate
});

export const OneCLeadPushResultSchema = z.object({
  acceptedAt: isoDate,
  oneCRequestId: z.string().optional()
});
