import {
  DEFAULT_SCENARIO, ENVELOPE_VALUES, DIALECT_VALUES, DATETIME_VALUES, FAIL_MODE_VALUES,
  type ScenarioConfig
} from './core/scenario';

type Env = Record<string, string | undefined>;

function pickEnum<T extends string>(env: Env, key: string, allowed: T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (!allowed.includes(raw as T)) {
    throw new Error(`${key}: unknown value "${raw}" (allowed: ${allowed.join(', ')})`);
  }
  return raw as T;
}

function pickNumber(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key}: expected a non-negative number, got "${raw}"`);
  return n;
}

function pickBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function loadScenario(env: Env): ScenarioConfig {
  return {
    envelope: pickEnum(env, 'MOCK1C_ENVELOPE', ENVELOPE_VALUES, DEFAULT_SCENARIO.envelope),
    statusDialect: pickEnum(env, 'MOCK1C_STATUS_DIALECT', DIALECT_VALUES, DEFAULT_SCENARIO.statusDialect),
    datetime: pickEnum(env, 'MOCK1C_DATETIME', DATETIME_VALUES, DEFAULT_SCENARIO.datetime),
    pageSize: pickNumber(env, 'MOCK1C_PAGE_SIZE', DEFAULT_SCENARIO.pageSize),
    malformedRate: pickNumber(env, 'MOCK1C_MALFORMED_RATE', DEFAULT_SCENARIO.malformedRate),
    duplicates: pickBool(env, 'MOCK1C_DUPLICATES', DEFAULT_SCENARIO.duplicates),
    failMode: pickEnum(env, 'MOCK1C_FAIL_MODE', FAIL_MODE_VALUES, DEFAULT_SCENARIO.failMode),
    latencyMs: pickNumber(env, 'MOCK1C_LATENCY_MS', DEFAULT_SCENARIO.latencyMs),
    pushFailRate: pickNumber(env, 'MOCK1C_PUSH_FAIL_RATE', DEFAULT_SCENARIO.pushFailRate)
  };
}

export type ServerConfig = { port: number; token: string };

export function loadServerConfig(env: Env): ServerConfig {
  return {
    port: pickNumber(env, 'MOCK1C_PORT', 4010),
    token: env.MOCK1C_TOKEN && env.MOCK1C_TOKEN !== '' ? env.MOCK1C_TOKEN : 'mock-token'
  };
}
