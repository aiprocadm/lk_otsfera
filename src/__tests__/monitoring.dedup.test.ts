import { describe, it, expect } from 'vitest';
import { diffAlerts, type ActiveAlert } from '@/lib/monitoring/dedup';
import type { Breach } from '@/lib/monitoring/evaluate';

const COOLDOWN = 6 * 3600_000;
const now = new Date('2026-05-31T12:00:00Z');
const breach = (key: string): Breach => ({ key, severity: 'warning', message: key, value: 1 });

describe('diffAlerts', () => {
  it('fires a breach with no active state', () => {
    const r = diffAlerts([breach('dlq:x')], [], now, COOLDOWN);
    expect(r.toFire.map((b) => b.key)).toEqual(['dlq:x']);
    expect(r.toRenotify).toEqual([]);
    expect(r.toResolve).toEqual([]);
  });

  it('stays silent for a firing breach within cooldown', () => {
    const active: ActiveAlert[] = [
      { key: 'dlq:x', lastNotifiedAt: new Date(now.getTime() - 60_000) }
    ];
    const r = diffAlerts([breach('dlq:x')], active, now, COOLDOWN);
    expect(r.toFire).toEqual([]);
    expect(r.toRenotify).toEqual([]);
  });

  it('re-notifies a firing breach past the cooldown', () => {
    const active: ActiveAlert[] = [
      { key: 'dlq:x', lastNotifiedAt: new Date(now.getTime() - COOLDOWN - 1) }
    ];
    const r = diffAlerts([breach('dlq:x')], active, now, COOLDOWN);
    expect(r.toRenotify.map((b) => b.key)).toEqual(['dlq:x']);
  });

  it('resolves an active alert whose breach has cleared', () => {
    const active: ActiveAlert[] = [{ key: 'dlq:x', lastNotifiedAt: now }];
    const r = diffAlerts([], active, now, COOLDOWN);
    expect(r.toResolve).toEqual(['dlq:x']);
  });
});
