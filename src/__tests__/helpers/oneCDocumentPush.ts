import type { OneCDocumentPushPayload } from '@/lib/services/oneCSync/dto';

/**
 * Эталонное тело выгрузки документа в 1С (этап 8, `У-167`) — ровно по
 * контракту docs/integrations/1c-contract.md, секция 6.
 *
 * Один источник на все тесты (схемы, адаптеры, mock-1c): если контракт
 * поменяется, править одно место, а не шесть копий; заодно jscpd не считает
 * повторы фикстуры дублированием кода.
 */
export function documentPushPayload(
  overrides: Partial<OneCDocumentPushPayload> = {}
): OneCDocumentPushPayload {
  return {
    externalId: 'doc-contract-1',
    type: 'invoice',
    number: 'С-2026-17',
    date: '2026-09-03T09:15:00Z',
    version: 1,
    counterparty: { inn: '7701234567', kpp: '770101001', name: 'ООО Ромашка', legalName: null },
    order: { externalId: '1c-order-1001', orderNumber: 'З-245' },
    parentDocument: null,
    lines: [
      {
        title: 'Обучение по охране труда, 40 ч',
        quantity: 3,
        unit: 'чел',
        price: 5000,
        vatRate: 0.2,
        vatAmount: 3000,
        amount: 18000,
      },
    ],
    totals: { net: 15000, vat: 3000, gross: 18000 },
    fileUrl: 'https://s3.example.com/documents/doc-contract-1.pdf?X-Amz-Signature=abc',
    ...overrides,
  };
}
