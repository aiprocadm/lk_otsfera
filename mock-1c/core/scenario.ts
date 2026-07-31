// Mock 1С scenario configuration. Pure data — no env, no I/O.
// Mirrors the // DECISION Q# surface of src/lib/services/oneCSync/rest-wire.ts:
// every knob here flips a behavior the real adapter must cope with.

export type EnvelopeShape = 'array' | 'items' | 'other'; // Q1
export type StatusDialect = 'app' | 'russian'; // Q10
export type DatetimeFormat = 'utc-z' | 'no-offset'; // Q7
export type FailMode = 'none' | 'transient' | 'permanent';

export type ScenarioConfig = {
  envelope: EnvelopeShape;
  statusDialect: StatusDialect;
  datetime: DatetimeFormat;
  pageSize: number; // Q6: 0 = no pagination; >0 = serve only the first page
  malformedRate: number; // >0 appends one schema-breaking record
  duplicates: boolean; // repeat the first record (same externalId)
  failMode: FailMode;
  latencyMs: number; // artificial delay before responding
  pushFailRate: number; // 0..1 chance POST /api/leads returns 500
};

export const DEFAULT_SCENARIO: ScenarioConfig = {
  envelope: 'array',
  statusDialect: 'app',
  datetime: 'utc-z',
  pageSize: 0,
  malformedRate: 0,
  duplicates: false,
  failMode: 'none',
  latencyMs: 0,
  pushFailRate: 0,
};

export const ENVELOPE_VALUES: EnvelopeShape[] = ['array', 'items', 'other'];
export const DIALECT_VALUES: StatusDialect[] = ['app', 'russian'];
export const DATETIME_VALUES: DatetimeFormat[] = ['utc-z', 'no-offset'];
export const FAIL_MODE_VALUES: FailMode[] = ['none', 'transient', 'permanent'];
