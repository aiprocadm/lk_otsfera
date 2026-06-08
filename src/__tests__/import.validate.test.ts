import { describe, it, expect } from 'vitest';
import { validateRows } from '@/lib/services/import/validate';

describe('validateRows', () => {
  it('separates valid payment rows from quarantine', () => {
    const raw = [
      { externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: null, isRefund: false, note: 'аванс' },
      { externalId: '', orgInn: '7700', amount: 1000, paidAt: 'garbage', method: null, isRefund: false, note: null },
    ];
    const { valid, quarantine } = validateRows('payments', raw);
    expect(valid).toHaveLength(1);
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0].rowIndex).toBe(1);
  });
});
