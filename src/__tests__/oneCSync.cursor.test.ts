import { describe, expect, it } from 'vitest';
import { applyOverlap } from '@/lib/services/oneCSync/cursor';

describe('applyOverlap', () => {
  it('subtracts N minutes and returns ISO string', () => {
    expect(applyOverlap(new Date('2026-05-12T10:00:00.000Z'), 5)).toBe('2026-05-12T09:55:00.000Z');
  });
  it('overlap 0 returns the same instant', () => {
    expect(applyOverlap(new Date('2026-05-12T10:00:00.000Z'), 0)).toBe('2026-05-12T10:00:00.000Z');
  });
});
