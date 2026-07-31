import type { ServiceType, TrainingStatus } from '@prisma/client';

/**
 * §5.6 ТЗ: условия завершения заявки. Проверка живёт в сервисе переходов
 * (manager/orderLifecycle.ts), НЕ в UI. Здесь — чистая функция над уже
 * загруженным заказом, чтобы её можно было юнит-тестировать без БД.
 *
 * Условия (по текущей схеме):
 *  - documents_uploaded — есть хотя бы один документ заявки со `scanStatus='clean'`
 *    (загружены сканы, прошедшие антивирус, §10 ТЗ);
 *  - accounting_signed  — менеджер отметил бухгалтерию подписанной
 *    (`Order.accountingSignedAt`, «галочка» §21 ТЗ);
 *  - certificates_issued — ТОЛЬКО для `serviceType='training'`: есть позиции
 *    и по каждой удостоверение выдано (`OrderItem.trainingStatus='certificate_issued'`).
 */
export type CompletionCondition =
  'documents_uploaded' | 'accounting_signed' | 'certificates_issued';

export type OrderCompletionInput = {
  serviceType: ServiceType;
  accountingSignedAt: Date | null;
  documents: ReadonlyArray<{ scanStatus: string }>;
  items: ReadonlyArray<{ trainingStatus: TrainingStatus }>;
};

/** Учебная специфика (удостоверения/слушатели) применяется только к обучению. */
export function isTrainingOrder(serviceType: ServiceType): boolean {
  return serviceType === 'training';
}

export function evaluateOrderCompletion(order: OrderCompletionInput): {
  ready: boolean;
  unmet: CompletionCondition[];
} {
  const unmet: CompletionCondition[] = [];

  if (!order.documents.some((d) => d.scanStatus === 'clean')) {
    unmet.push('documents_uploaded');
  }

  if (order.accountingSignedAt === null) {
    unmet.push('accounting_signed');
  }

  if (isTrainingOrder(order.serviceType)) {
    const allIssued =
      order.items.length > 0 && order.items.every((i) => i.trainingStatus === 'certificate_issued');
    if (!allIssued) unmet.push('certificates_issued');
  }

  return { ready: unmet.length === 0, unmet };
}
