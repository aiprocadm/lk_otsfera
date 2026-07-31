export type Thresholds = {
  queueWaitingMax: number;
  dlqMax: number;
  syncLagMaxMs: number;
  renotifyCooldownMs: number;
  oneCDeadLetterMax: number;
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getThresholds(env: Record<string, string | undefined> = process.env): Thresholds {
  return {
    queueWaitingMax: num(env.ALERT_QUEUE_WAITING_MAX, 100),
    dlqMax: num(env.ALERT_DLQ_MAX, 0),
    syncLagMaxMs: num(env.ALERT_SYNC_LAG_MAX_HOURS, 24) * 3600_000,
    renotifyCooldownMs: num(env.ALERT_RENOTIFY_COOLDOWN_HOURS, 6) * 3600_000,
    oneCDeadLetterMax: num(env.ALERT_ONEC_DEADLETTER_MAX, 0),
  };
}
