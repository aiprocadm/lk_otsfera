import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import type { MangoAdapter } from './types';

export type MangoRestConfig = {
  apiKey?: string | undefined;
  apiSalt?: string | undefined;
  baseUrl: string;
};

const DEFAULT_BASE_URL = 'https://app.mango-office.ru/vpbx/';

/** Эффективный конфиг: настройки интеграций (БД после prime) → env fallback. */
export function readMangoConfig(): MangoRestConfig {
  return {
    apiKey: cachedIntegrationSetting('mango.apiKey') ?? undefined,
    apiSalt: cachedIntegrationSetting('mango.apiSalt') ?? undefined,
    baseUrl: cachedIntegrationSetting('mango.vpbxBaseUrl') ?? DEFAULT_BASE_URL,
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
  private readonly overrides: MangoRestConfig | null;

  constructor(config?: MangoRestConfig) {
    this.overrides = config ?? null;
  }

  /**
   * Конфиг читается лениво при каждом обращении (не в конструкторе):
   * адаптер — кэшированный синглтон, а настройки редактируются в
   * /admin/integrations — пересоздание не требуется.
   */
  protected get config(): MangoRestConfig {
    return this.overrides ?? readMangoConfig();
  }

  async fetchRecording(
    recordingId: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
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
  async initiateCallback(_input: {
    fromInternal: string;
    toNumber: string;
  }): Promise<{ commandId: string }> {
    void _input;
    void this.config;
    throw new Error(
      'RestMangoAdapter.initiateCallback not wired yet (owner enables live callback)'
    );
  }
}
