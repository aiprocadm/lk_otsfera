import type { z } from 'zod';
import type {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCLeadPushResultSchema,
} from './schemas';

export type OneCOrgDto = z.infer<typeof OneCOrgSchema>;
export type OneCOrderDto = z.infer<typeof OneCOrderSchema>;
export type OneCPaymentDto = z.infer<typeof OneCPaymentSchema>;
export type OneCDocumentDto = z.infer<typeof OneCDocumentSchema>;
export type OneCLeadPushResult = z.infer<typeof OneCLeadPushResultSchema>;

// Outbound payload we construct — no need to runtime-validate our own output.
export type OneCLeadPushPayload = {
  partnerExternalId?: string | undefined;
  partnerSlug?: string | undefined;
  cabinetLeadId: string;
  clientCompanyName: string;
  clientInn?: string | undefined;
  clientContactName: string;
  clientContactPhone?: string | undefined;
  clientContactEmail?: string | undefined;
  subject: string;
  estimatedAmount?: number | undefined;
  productType: string[];
  notes?: string | undefined;
};

export type SyncCursor = {
  since?: string;
};
