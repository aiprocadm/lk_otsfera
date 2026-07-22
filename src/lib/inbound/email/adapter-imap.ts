import type { InboundEmailAdapter, InboundEmailFetchResult } from './adapter';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

export type ImapConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  tls: boolean;
};

/** Эффективный конфиг: настройки интеграций (БД после prime) → env fallback. */
export function readImapConfig(): ImapConfig {
  const rawPort = cachedIntegrationSetting('imap.port');
  const port = rawPort ? Number(rawPort) : undefined;
  const rawTls = (cachedIntegrationSetting('imap.tls') ?? '1').trim().toLowerCase();
  return {
    host: cachedIntegrationSetting('imap.host') ?? undefined,
    port: Number.isFinite(port) ? port : undefined,
    user: cachedIntegrationSetting('imap.user') ?? undefined,
    password: cachedIntegrationSetting('imap.password') ?? undefined,
    tls: rawTls !== '0' && rawTls !== 'false' && rawTls !== 'off'
  };
}

/**
 * Stub adapter — performs NO network I/O. Wiring a real IMAP client is
 * deferred; this class exists only to establish the port/seam so the fake
 * can be swapped later without touching call sites.
 *
 * Config is read lazily per call (not at construction): the adapter is a
 * cached singleton, while settings are edited in /admin/integrations — the
 * poll processor primes the settings cache before each run.
 */
export class ImapInboundEmailAdapter implements InboundEmailAdapter {
  private readonly overrides: ImapConfig | null;

  constructor(config?: ImapConfig) {
    this.overrides = config ?? null;
  }

  protected get config(): ImapConfig {
    return this.overrides ?? readImapConfig();
  }

  async fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult> {
    void cursor;
    void this.config;
    throw new Error('IMAP inbound adapter not wired (set INBOUND_EMAIL_ADAPTER=fake for tests)');
  }
}
