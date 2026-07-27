import type { ServiceType, TrainingStatus } from '@prisma/client';

/**
 * Этап 12 (Модуль 5, ФТ-5.1) — готовность заказа к передаче результата.
 *
 * Расширяет «условия завершения» (`completion.ts`, Трек A) до попозиционной
 * картины, которую требует ТЗ: менеджеру нужно видеть не «чего-то не хватает»,
 * а ЧЕГО именно и по какому слушателю.
 *
 * Чистая функция над уже загруженным заказом — без БД, юнит-тестируема.
 *
 * Правила (§3 спеки этапа 12):
 *  - `training` — по каждой позиции: обучение завершено · удостоверение
 *    создано · скан удостоверения загружен;
 *  - `document_development` — загружены исходящие документы И менеджер явно
 *    отметил «работа согласована» (`deliverablesApprovedAt`, решение §6-2:
 *    автоматический вывод из факта загрузки недостаточен).
 */

/** Чего не хватает по конкретной позиции обучения. */
export type ItemGap =
  | 'training_incomplete'
  | 'certificate_missing'
  | 'certificate_scan_missing'
  | 'certificate_scan_infected';

export type ItemReadiness = {
  itemId: string;
  studentName: string;
  gaps: ItemGap[];
};

/** Чего не хватает по заказу в целом. */
export type OrderGap =
  | 'items_missing'
  | 'items_not_ready'
  | 'deliverables_missing'
  | 'deliverables_not_approved';

export type ReadinessInput = {
  serviceType: ServiceType;
  deliverablesApprovedAt: Date | null;
  documents: ReadonlyArray<{ direction: string; scanStatus: string }>;
  items: ReadonlyArray<{
    id: string;
    trainingStatus: TrainingStatus;
    studentName: string;
    certificate: {
      documentId: string | null;
      /** Этап 12 PR-2: вердикт ClamAV по скану; `undefined` — статус не читали. */
      scanStatus?: string | null;
    } | null;
  }>;
};

export type OrderReadiness = {
  ready: boolean;
  gaps: OrderGap[];
  /** Заполняется только для обучения — по позициям с недостачей. */
  items: ItemReadiness[];
};

function itemGaps(item: ReadinessInput['items'][number]): ItemGap[] {
  const gaps: ItemGap[] = [];
  if (item.trainingStatus !== 'certificate_issued') gaps.push('training_incomplete');
  if (!item.certificate) gaps.push('certificate_missing');
  else if (item.certificate.documentId === null) gaps.push('certificate_scan_missing');
  // Этап 12 PR-2 (ФТ-5.3): скан ClamAV асинхронный, поэтому «заражённый файл не
  // привязывается» действует здесь — заражённый скан не закрывает чек-лист.
  // `pending` пробелом не считается: вердикта ещё нет, а клиенту файл всё равно
  // не отдадут (download → 410) до вердикта.
  else if (item.certificate.scanStatus === 'infected') gaps.push('certificate_scan_infected');
  return gaps;
}

export function evaluateOrderReadiness(input: ReadinessInput): OrderReadiness {
  const gaps: OrderGap[] = [];

  if (input.serviceType === 'training') {
    if (input.items.length === 0) {
      // Учебный заказ без позиций передавать нечего — это не «готов».
      return { ready: false, gaps: ['items_missing'], items: [] };
    }
    const items = input.items
      .map((i) => ({ itemId: i.id, studentName: i.studentName, gaps: itemGaps(i) }))
      .filter((i) => i.gaps.length > 0);
    if (items.length > 0) gaps.push('items_not_ready');
    return { ready: gaps.length === 0, gaps, items };
  }

  // document_development
  const hasOutgoing = input.documents.some(
    (d) => d.direction === 'outgoing' && d.scanStatus === 'clean'
  );
  if (!hasOutgoing) gaps.push('deliverables_missing');
  // Решение заказчика §6-2: отметка согласования обязательна и ставится руками.
  if (input.deliverablesApprovedAt === null) gaps.push('deliverables_not_approved');

  return { ready: gaps.length === 0, gaps, items: [] };
}

/** RU-подписи для блока «Готовность к передаче» (user-facing, §13 CLAUDE.md). */
export const ORDER_GAP_RU: Record<OrderGap, string> = {
  items_missing: 'В заказе нет ни одного слушателя',
  items_not_ready: 'Не по всем слушателям готовы удостоверения',
  deliverables_missing: 'Не загружены итоговые документы',
  deliverables_not_approved: 'Менеджер не отметил работу согласованной'
};

export const ITEM_GAP_RU: Record<ItemGap, string> = {
  training_incomplete: 'обучение не завершено',
  certificate_missing: 'удостоверение не создано',
  certificate_scan_missing: 'не загружен скан удостоверения',
  certificate_scan_infected: 'скан удостоверения заражён — загрузите другой файл'
};
