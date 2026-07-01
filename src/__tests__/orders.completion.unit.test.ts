import { describe, it, expect } from 'vitest';
import {
  evaluateOrderCompletion,
  isTrainingOrder,
  type OrderCompletionInput
} from '@/lib/orders/completion';

const base: OrderCompletionInput = {
  serviceType: 'training',
  accountingSignedAt: new Date('2026-07-01T00:00:00Z'),
  documents: [{ scanStatus: 'clean' }],
  items: [{ trainingStatus: 'certificate_issued' }]
};

describe('isTrainingOrder', () => {
  it('true only for training', () => {
    expect(isTrainingOrder('training')).toBe(true);
    expect(isTrainingOrder('document_development')).toBe(false);
  });
});

describe('evaluateOrderCompletion', () => {
  it('ready when all training conditions met', () => {
    expect(evaluateOrderCompletion(base)).toEqual({ ready: true, unmet: [] });
  });

  it('blocks when no clean scan present', () => {
    const r = evaluateOrderCompletion({ ...base, documents: [{ scanStatus: 'pending' }] });
    expect(r.ready).toBe(false);
    expect(r.unmet).toContain('documents_uploaded');
  });

  it('blocks when there are no documents at all', () => {
    const r = evaluateOrderCompletion({ ...base, documents: [] });
    expect(r.unmet).toContain('documents_uploaded');
  });

  it('blocks when accounting is not signed', () => {
    const r = evaluateOrderCompletion({ ...base, accountingSignedAt: null });
    expect(r.ready).toBe(false);
    expect(r.unmet).toContain('accounting_signed');
  });

  it('blocks when a certificate is not issued (training)', () => {
    const r = evaluateOrderCompletion({ ...base, items: [{ trainingStatus: 'pending' }] });
    expect(r.unmet).toContain('certificates_issued');
  });

  it('blocks when a training order has no items', () => {
    const r = evaluateOrderCompletion({ ...base, items: [] });
    expect(r.unmet).toContain('certificates_issued');
  });

  it('lists every unmet condition together', () => {
    const r = evaluateOrderCompletion({
      serviceType: 'training',
      accountingSignedAt: null,
      documents: [],
      items: []
    });
    expect(r.ready).toBe(false);
    expect(r.unmet.sort()).toEqual(
      ['accounting_signed', 'certificates_issued', 'documents_uploaded'].sort()
    );
  });

  it('skips the certificate check for non-training service types', () => {
    const r = evaluateOrderCompletion({
      ...base,
      serviceType: 'document_development',
      items: []
    });
    expect(r.ready).toBe(true);
    expect(r.unmet).toEqual([]);
  });
});
