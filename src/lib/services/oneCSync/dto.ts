import type { z } from 'zod';
import type {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCLeadPushResultSchema
} from './schemas';

export type OneCOrgDto = z.infer<typeof OneCOrgSchema>;
export type OneCOrderDto = z.infer<typeof OneCOrderSchema>;
export type OneCPaymentDto = z.infer<typeof OneCPaymentSchema>;
export type OneCDocumentDto = z.infer<typeof OneCDocumentSchema>;
export type OneCLeadPushResult = z.infer<typeof OneCLeadPushResultSchema>;

// Outbound payload we construct — no need to runtime-validate our own output.
export type OneCLeadPushPayload = {
  partnerExternalId?: string;
  partnerSlug?: string;
  cabinetLeadId: string;
  clientCompanyName: string;
  clientInn?: string;
  clientContactName: string;
  clientContactPhone?: string;
  clientContactEmail?: string;
  subject: string;
  estimatedAmount?: number;
  productType: string[];
  notes?: string;
};

export type SyncCursor = {
  since?: string;
};
