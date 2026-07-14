import type { MangoAdapter } from './index';

export type MangoRestConfig = {
  apiKey?: string;
  apiSalt?: string;
  baseUrl: string;
};

const DEFAULT_BASE_URL = 'https://app.mango-office.ru/vpbx/';

function readMangoConfigFromEnv(): MangoRestConfig {
  return {
    apiKey: process.env.MANGO_API_KEY,
    apiSalt: process.env.MANGO_API_SALT,
    baseUrl: process.env.MANGO_VPBX_BASE_URL ?? DEFAULT_BASE_URL
  };
}

/**
 * Stub adapter — reads Mango VPBX REST config from env at construction time
 * but performs NO network I/O. Wiring the real HTTP client is deferred to
 * boarding; this class exists only to establish the port/seam so the fake
 * can be swapped later without touching call sites.
 *
 * Intended request shape (Mango VPBX API, https://app.mango-office.ru/vpbx/):
 * every call is a signed `application/x-www-form-urlencoded` POST with a
 * `vpbx_api_key` field, a `json` field (the request payload, JSON-encoded),
 * and a `sign` field computed via `computeMangoSign(apiKey, json, apiSalt)`
 * from `./sign`. E.g. for stats:
 *
 *   const json = JSON.stringify({ date_from, date_to });
 *   const sign = computeMangoSign(config.apiKey, json, config.apiSalt);
 *   POST `${baseUrl}stats/request` with body
 *     `vpbx_api_key=${apiKey}&sign=${sign}&json=${encodeURIComponent(json)}`
 *
 * Recording download and stats-result polling follow the same envelope
 * against their respective Mango endpoints.
 */
export class RestMangoAdapter implements MangoAdapter {
  private readonly config: MangoRestConfig;

  constructor(config: MangoRestConfig = readMangoConfigFromEnv()) {
    this.config = config;
  }

  async fetchRecording(recordingId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    void recordingId;
    void this.config;
    throw new Error('Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)');
  }

  async requestStats(range: { from: string; to: string }): Promise<{ key: string }> {
    void range;
    void this.config;
    throw new Error('Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)');
  }

  async fetchStatsResult(key: string): Promise<{ ready: boolean; rows: unknown[] }> {
    void key;
    void this.config;
    throw new Error('Mango REST adapter not wired (set MANGO_ADAPTER=fake for tests)');
  }

  // POST {MANGO_VPBX_BASE_URL}/commands/callback — signature as in the other calls.
  // Response shape (command_id) confirmed against Mango docs at live wiring.
  async initiateCallback(_input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }> {
    void _input;
    void this.config;
    throw new Error('RestMangoAdapter.initiateCallback not wired yet (owner enables live callback)');
  }
}
