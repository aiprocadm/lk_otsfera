const DAY_MS = 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * DAY_MS;
export const FOURTEEN_DAYS_MS = 14 * DAY_MS;
export const THREE_DAYS_MS = 3 * DAY_MS;
export const ONE_DAY_MS = 1 * DAY_MS;
export const ATTENTION_CAP_PER_SOURCE = 10;
export const DEFAULT_EVENTS = 15;

// ExecutionStatus enum: pending | in_progress | completed | cancelled | on_hold
export const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
export const TERMINAL_EXEC = ['completed', 'cancelled'] as const;
