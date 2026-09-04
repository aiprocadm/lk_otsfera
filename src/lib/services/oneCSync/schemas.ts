import { z } from 'zod';
import { isValidInn } from './inn';

// Accepts anything Date.parse understands; rejects garbage. Tightening to a strict
// format is DECISION Q7 (datetime format from 1C) — keep permissive until confirmed.
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid datetime' });

export const OneCOrgSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  legalName: z.string().optional(),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  // `У-171` (этап 8): реквизиты контрагента — те же колонки, что заполняет
  // менеджер в карточке организации для автогенерации документов (ФТ-9.1).
  // Все необязательные: пустое из 1С не затирает заполненное у нас
  // (writers.ts, `nonEmptyOnly`).
  ogrn: z.string().optional(),
  legalAddress: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  corrAccount: z.string().optional(),
  bic: z.string().optional(),
  signerName: z.string().optional(),
  signerPosition: z.string().optional(),
  signerBasis: z.string().optional(),
  partnerExternalId: z.string().optional(),
  updatedAt: isoDate,
});

/**
 * Файловая схема контрагента (ТЗ починки импорта, Т-21). Ключ синтезируется из
 * ИНН (Т-16), поэтому строка без валидного ИНН не может стать организацией:
 * `no_inn` / `bad_inn` уходят в таблицу ошибок через штатный канал
 * `parseRecords`, батч продолжается.
 *
 * НАМЕРЕННО отдельная от `OneCOrgSchema`: сетевой `adapter-rest` несёт
 * настоящие externalId и не обязан проходить контрольную сумму ИНН — вшивать
 * проверку в общий writer значило бы менять поведение сетевого обмена за
 * рамками ТЗ.
 */
export const OneCOrgFileSchema = OneCOrgSchema.superRefine((org, ctx) => {
  if (!org.inn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'no_inn' });
  } else if (!isValidInn(org.inn)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bad_inn' });
  }
});

export const OneCOrderSchema = z
  .object({
    externalId: z.string().min(1),
    orderNumber: z.string().optional(),
    title: z.string().min(1),
    organizationExternalId: z.string().min(1).optional(),
    organizationInn: z.string().min(1).optional(),
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
    updatedAt: isoDate,
  })
  .refine((o) => !!o.organizationExternalId || !!o.organizationInn, {
    message: 'order requires organizationExternalId or organizationInn',
  });

export const OneCPaymentSchema = z
  .object({
    externalId: z.string().min(1),
    orderExternalId: z.string().min(1).optional(),
    organizationExternalId: z.string().min(1).optional(),
    organizationInn: z.string().min(1).optional(),
    amount: z.number(),
    paidAt: isoDate,
    method: z.string().optional(),
    isRefund: z.boolean(),
    purpose: z.string().nullish(),
    paymentOrderNumber: z.string().nullish(),
    vatAmount: z.number().nullish(),
    updatedAt: isoDate,
  })
  .refine((p) => !!p.orderExternalId || !!p.organizationExternalId || !!p.organizationInn, {
    message: 'payment requires orderExternalId or organizationExternalId or organizationInn',
  });

export const OneCDocumentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1),
  type: z.enum([
    'contract',
    'extra_agreement',
    'invoice',
    'act',
    'waybill',
    'certificate',
    'report',
    'other',
  ]),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number(),
  signedAt: isoDate.optional(),
  downloadUrl: z.string().min(1),
  updatedAt: isoDate,
  /**
   * `У-170` (`Д-25`): кто выпустил бумагу. Раньше всё из 1С писалось
   * «входящим» литералом в writer'е — и подписанный нами же договор,
   * вернувшись из 1С, менял направление. Умолчание `incoming` — для 1С,
   * которая поле ещё не отдаёт: её собственные документы входящие и есть.
   */
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
  /** `У-170`: номер документа в 1С — третий ключ поиска «тип + номер». */
  number: z.string().optional(),
});

export const OneCLeadPushResultSchema = z.object({
  acceptedAt: isoDate,
  oneCRequestId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Этап 8 (`У-167`): выгрузка документов кабинета в 1С —
// docs/integrations/1c-contract.md, секции 6–7.
// ---------------------------------------------------------------------------

/**
 * Типы документов, которые вообще могут уехать в 1С. КП не выгружается
 * (`Р-14`) — его здесь нет, и схема тела его отвергнет.
 *
 * Единственный источник для кода; умолчание `Company.oneCDocumentPushTypes`
 * и CHECK-ограничение в базе обязаны совпадать с этим списком — страж
 * `oneCSync.pushable-types.guardrail` сверяет все три места.
 */
export const ONE_C_PUSHABLE_TYPES = ['invoice', 'act', 'contract', 'extra_agreement'] as const;

export type OneCPushableType = (typeof ONE_C_PUSHABLE_TYPES)[number];

/** Тип документа выгружается в 1С. Одна проверка для процессора, продюсера и экранов (`У-169`). */
export function isOneCPushableType(type: string): type is OneCPushableType {
  return (ONE_C_PUSHABLE_TYPES as readonly string[]).includes(type);
}

// `finite`, а не просто `number`: NaN/Infinity в JSON превращаются в `null`, и
// 1С получила бы «сумму null» без единого предупреждения с нашей стороны.
const finite = z.number().finite();

const OneCDocumentPushLineSchema = z.object({
  title: z.string().min(1),
  quantity: finite.nonnegative(),
  unit: z.string().min(1),
  price: finite,
  /** Доля (0.2 = 20 %), не проценты; `null` — «без НДС». */
  vatRate: finite.min(0).max(1).nullable(),
  vatAmount: finite,
  amount: finite,
});

export const OneCDocumentPushSchema = z.object({
  /** id ПЕРВОЙ версии цепочки перевыпусков — общий для всех версий (секция 7). */
  externalId: z.string().min(1),
  type: z.enum(ONE_C_PUSHABLE_TYPES),
  number: z.string().min(1),
  date: isoDate,
  version: z.number().int().min(1),
  counterparty: z.object({
    inn: z.string().min(1),
    kpp: z.string().nullable(),
    name: z.string().min(1),
    legalName: z.string().nullable(),
  }),
  /** `externalId: null` — заказ заведён в кабинете и в 1С ещё не бывал. */
  order: z
    .object({ externalId: z.string().min(1).nullable(), orderNumber: z.string().nullable() })
    .nullable(),
  parentDocument: z.object({ externalId: z.string().min(1), number: z.string().min(1) }).nullable(),
  lines: z.array(OneCDocumentPushLineSchema).nullable(),
  totals: z.object({ net: finite, vat: finite, gross: finite }).nullable(),
  /** Presigned-ссылка на PDF; живёт час (секция 6). */
  fileUrl: z.string().url(),
});

export const OneCDocumentPushResultSchema = z.object({
  externalId: z.string().min(1),
});
