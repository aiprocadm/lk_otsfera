import type { Breach } from './evaluate';

export type ActiveAlert = { key: string; lastNotifiedAt: Date };

export type AlertDiff = {
  toFire: Breach[]; // breaches with no active firing state
  toRenotify: Breach[]; // still firing, past cooldown
  toResolve: string[]; // keys that were firing but no longer breach
};

export function diffAlerts(
  breaches: Breach[],
  active: ActiveAlert[],
  now: Date,
  cooldownMs: number
): AlertDiff {
  const activeByKey = new Map(active.map((a) => [a.key, a]));
  const breachKeys = new Set(breaches.map((b) => b.key));

  const toFire: Breach[] = [];
  const toRenotify: Breach[] = [];
  for (const b of breaches) {
    const a = activeByKey.get(b.key);
    if (!a) {
      toFire.push(b);
    } else if (now.getTime() - a.lastNotifiedAt.getTime() > cooldownMs) {
      toRenotify.push(b);
    }
    // else: within cooldown → silent
  }

  const toResolve = active.filter((a) => !breachKeys.has(a.key)).map((a) => a.key);
  return { toFire, toRenotify, toResolve };
}
