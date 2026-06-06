import { describe, it, expect } from 'vitest';
import { loadScenario, loadServerConfig } from './config';
import { DEFAULT_SCENARIO } from './core/scenario';

describe('loadScenario', () => {
  it('returns defaults for an empty env', () => {
    expect(loadScenario({})).toEqual(DEFAULT_SCENARIO);
  });

  it('parses known values', () => {
    const s = loadScenario({
      MOCK1C_ENVELOPE: 'items', MOCK1C_STATUS_DIALECT: 'russian',
      MOCK1C_DATETIME: 'no-offset', MOCK1C_PAGE_SIZE: '2',
      MOCK1C_MALFORMED_RATE: '0.5', MOCK1C_DUPLICATES: '1',
      MOCK1C_FAIL_MODE: 'transient', MOCK1C_LATENCY_MS: '300', MOCK1C_PUSH_FAIL_RATE: '0.1'
    });
    expect(s).toEqual({
      envelope: 'items', statusDialect: 'russian', datetime: 'no-offset',
      pageSize: 2, malformedRate: 0.5, duplicates: true,
      failMode: 'transient', latencyMs: 300, pushFailRate: 0.1
    });
  });

  it('fail-fast on an unknown enum value (never silently defaults)', () => {
    expect(() => loadScenario({ MOCK1C_ENVELOPE: 'xml' })).toThrow(/MOCK1C_ENVELOPE/);
    expect(() => loadScenario({ MOCK1C_FAIL_MODE: 'boom' })).toThrow(/MOCK1C_FAIL_MODE/);
  });

  it('fail-fast on a non-numeric numeric field', () => {
    expect(() => loadScenario({ MOCK1C_PAGE_SIZE: 'lots' })).toThrow(/MOCK1C_PAGE_SIZE/);
  });
});

describe('loadServerConfig', () => {
  it('defaults port 4010 / token mock-token', () => {
    expect(loadServerConfig({})).toEqual({ port: 4010, token: 'mock-token' });
  });
  it('reads overrides', () => {
    expect(loadServerConfig({ MOCK1C_PORT: '5000', MOCK1C_TOKEN: 'secret' }))
      .toEqual({ port: 5000, token: 'secret' });
  });
});
