import type { InboundEmailAdapter, InboundEmailFetchResult } from './adapter';

export type ImapConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  tls: boolean;
};

function readImapConfigFromEnv(): ImapConfig {
  const port = process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : undefined;
  return {
    host: process.env.IMAP_HOST,
    port: Number.isFinite(port) ? port : undefined,
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    tls: (process.env.IMAP_TLS ?? '1').trim().toLowerCase() !== '0'
      && (process.env.IMAP_TLS ?? '1').trim().toLowerCase() !== 'false'
      && (process.env.IMAP_TLS ?? '1').trim().toLowerCase() !== 'off'
  };
}

/**
 * Stub adapter — reads IMAP connection config from env at construction time
 * but performs NO network I/O. Wiring a real IMAP client is deferred; this
 * class exists only to establish the port/seam so the fake can be swapped
 * later without touching call sites.
 */
export class ImapInboundEmailAdapter implements InboundEmailAdapter {
  private readonly config: ImapConfig;

  constructor(config: ImapConfig = readImapConfigFromEnv()) {
    this.config = config;
  }

  async fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult> {
    void cursor;
    void this.config;
    throw new Error('IMAP inbound adapter not wired (set INBOUND_EMAIL_ADAPTER=fake for tests)');
  }
}
