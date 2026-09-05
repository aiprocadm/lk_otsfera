// Barrel домена logging. Edge- и client-логгеры НЕ реэкспортируются намеренно:
// у них другие runtime-ограничения — импортируй `@/lib/logging/edge` и
// `@/lib/logging/client` напрямую, чтобы бандлер не тянул pino куда не надо.
export { log, createLogger } from './logger';
export { bestEffort } from './bestEffort';
export { REDACTED } from './scrub';
