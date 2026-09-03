import type { z } from 'zod';
import type {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCLeadPushResultSchema,
  OneCDocumentPushSchema,
  OneCDocumentPushResultSchema,
} from './schemas';

export type OneCOrgDto = z.infer<typeof OneCOrgSchema>;
export type OneCOrderDto = z.infer<typeof OneCOrderSchema>;
/**
 * Платёж. Схема описывает контракт 1С; поле `organizationId` — локальное
 * расширение (`У-88`): его ставят только пути внутри ЛК (импорт выписки, матч
 * по ключу названия), чтобы адресовать организацию БЕЗ ИНН и без 1С-ключа.
 * В схему оно намеренно не входит — из 1С такой адрес прийти не может.
 */
export type OneCPaymentDto = z.infer<typeof OneCPaymentSchema> & {
  organizationId?: string;
};
export type OneCDocumentDto = z.infer<typeof OneCDocumentSchema>;
export type OneCLeadPushResult = z.infer<typeof OneCLeadPushResultSchema>;
/**
 * Этап 8 (`У-167`): исходящий документ и ответ 1С. В отличие от заявки тип
 * выводится из схемы: тело проверяется ею в `mock-1c`, и второе, рукописное
 * описание разошлось бы с первым при первой же правке контракта.
 */
export type OneCDocumentPushPayload = z.infer<typeof OneCDocumentPushSchema>;
export type OneCDocumentPushResult = z.infer<typeof OneCDocumentPushResultSchema>;

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
