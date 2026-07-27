import { describe, it, expect } from 'vitest';
import {
  evaluateOrderReadiness,
  ORDER_GAP_RU,
  ITEM_GAP_RU,
  type ReadinessInput
} from '@/lib/orders/readiness';

/**
 * Этап 12 (Модуль 5, ФТ-5.1): готовность заказа к передаче — попозиционно для
 * обучения, «документы + отметка согласования» для разработки документов
 * (решение заказчика §6-2).
 */

const trainingItem = (over: Partial<ReadinessInput['items'][number]> = {}) => ({
  id: 'i1',
  trainingStatus: 'certificate_issued' as const,
  studentName: 'Иванов Иван',
  certificate: { documentId: 'doc-1' },
  ...over
});

const training = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  serviceType: 'training',
  deliverablesApprovedAt: null,
  documents: [],
  items: [trainingItem()],
  ...over
});

const docs = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  serviceType: 'document_development',
  deliverablesApprovedAt: new Date('2026-07-01'),
  documents: [{ direction: 'outgoing', scanStatus: 'clean' }],
  items: [],
  ...over
});

describe('обучение: попозиционная готовность', () => {
  it('все позиции закрыты → готов, без замечаний', () => {
    const r = evaluateOrderReadiness(training());
    expect(r).toEqual({ ready: true, gaps: [], items: [] });
  });

  it('заказ без слушателей передавать нечего', () => {
    const r = evaluateOrderReadiness(training({ items: [] }));
    expect(r.ready).toBe(false);
    expect(r.gaps).toEqual(['items_missing']);
  });

  it('обучение не завершено → замечание по конкретному слушателю', () => {
    const r = evaluateOrderReadiness(
      training({ items: [trainingItem({ trainingStatus: 'in_progress', studentName: 'Петров' })] })
    );
    expect(r.ready).toBe(false);
    expect(r.gaps).toEqual(['items_not_ready']);
    expect(r.items).toEqual([
      { itemId: 'i1', studentName: 'Петров', gaps: ['training_incomplete'] }
    ]);
  });

  it('удостоверения нет вовсе → certificate_missing', () => {
    const r = evaluateOrderReadiness(training({ items: [trainingItem({ certificate: null })] }));
    expect(r.items[0]!.gaps).toEqual(['certificate_missing']);
  });

  it('удостоверение есть, скана нет → certificate_scan_missing', () => {
    const r = evaluateOrderReadiness(
      training({ items: [trainingItem({ certificate: { documentId: null } })] })
    );
    expect(r.items[0]!.gaps).toEqual(['certificate_scan_missing']);
  });

  it('несколько недостач по одной позиции копятся', () => {
    const r = evaluateOrderReadiness(
      training({ items: [trainingItem({ trainingStatus: 'pending', certificate: null })] })
    );
    expect(r.items[0]!.gaps).toEqual(['training_incomplete', 'certificate_missing']);
  });

  it('готовые позиции в список замечаний не попадают', () => {
    const r = evaluateOrderReadiness(
      training({
        items: [trainingItem(), trainingItem({ id: 'i2', certificate: null, studentName: 'Второй' })]
      })
    );
    expect(r.items.map((i) => i.itemId)).toEqual(['i2']);
  });
});

describe('разработка документов: файлы + отметка согласования', () => {
  it('исходящий документ загружен и работа согласована → готов', () => {
    expect(evaluateOrderReadiness(docs())).toEqual({ ready: true, gaps: [], items: [] });
  });

  it('нет исходящих документов → замечание', () => {
    const r = evaluateOrderReadiness(docs({ documents: [] }));
    expect(r.gaps).toContain('deliverables_missing');
  });

  it('входящий документ не считается результатом', () => {
    const r = evaluateOrderReadiness(
      docs({ documents: [{ direction: 'incoming', scanStatus: 'clean' }] })
    );
    expect(r.gaps).toContain('deliverables_missing');
  });

  it('заражённый файл не считается результатом', () => {
    const r = evaluateOrderReadiness(
      docs({ documents: [{ direction: 'outgoing', scanStatus: 'infected' }] })
    );
    expect(r.gaps).toContain('deliverables_missing');
  });

  it('файлы есть, но менеджер не отметил согласование → не готов (решение §6-2)', () => {
    const r = evaluateOrderReadiness(docs({ deliverablesApprovedAt: null }));
    expect(r.ready).toBe(false);
    expect(r.gaps).toEqual(['deliverables_not_approved']);
  });

  it('позиции обучения на такой заказ не влияют', () => {
    const r = evaluateOrderReadiness(docs({ items: [trainingItem({ certificate: null })] }));
    expect(r.ready).toBe(true);
    expect(r.items).toEqual([]);
  });
});

describe('русские подписи', () => {
  it('каждому коду замечания есть подпись', () => {
    for (const key of Object.keys(ORDER_GAP_RU)) {
      expect(ORDER_GAP_RU[key as keyof typeof ORDER_GAP_RU].length).toBeGreaterThan(0);
    }
    for (const key of Object.keys(ITEM_GAP_RU)) {
      expect(ITEM_GAP_RU[key as keyof typeof ITEM_GAP_RU].length).toBeGreaterThan(0);
    }
  });
});

/**
 * Этап 12 PR-2 (ФТ-5.3): вердикт антивируса по скану. Скан асинхронный, поэтому
 * «заражённый файл не привязывается» действует здесь — заражённый скан не
 * закрывает пункт чек-листа, а `pending` (вердикта ещё нет) не мешает.
 */
describe('статус скана удостоверения (PR-2)', () => {
  it('заражённый скан → отдельный пробел, заказ не готов', () => {
    const res = evaluateOrderReadiness(
      training({
        items: [trainingItem({ certificate: { documentId: 'doc-1', scanStatus: 'infected' } })]
      })
    );
    expect(res.ready).toBe(false);
    expect(res.items[0].gaps).toEqual(['certificate_scan_infected']);
  });

  it('чистый скан готовности не мешает', () => {
    const res = evaluateOrderReadiness(
      training({
        items: [trainingItem({ certificate: { documentId: 'doc-1', scanStatus: 'clean' } })]
      })
    );
    expect(res.ready).toBe(true);
  });

  it('скан на проверке (pending) считается загруженным', () => {
    const res = evaluateOrderReadiness(
      training({
        items: [trainingItem({ certificate: { documentId: 'doc-1', scanStatus: 'pending' } })]
      })
    );
    expect(res.ready).toBe(true);
  });

  it('без скана заражение не проверяется — пробел прежний', () => {
    const res = evaluateOrderReadiness(
      training({
        items: [trainingItem({ certificate: { documentId: null, scanStatus: 'infected' } })]
      })
    );
    expect(res.items[0].gaps).toEqual(['certificate_scan_missing']);
  });
});
