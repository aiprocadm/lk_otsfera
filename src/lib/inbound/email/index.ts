import type { InboundEmailAdapter } from './adapter';
import { FakeInboundEmailAdapter } from './adapter-fake';
import { ImapInboundEmailAdapter } from './adapter-imap';

let cached: InboundEmailAdapter | null = null;

export function getInboundEmailAdapter(): InboundEmailAdapter {
  if (cached) return cached;
  const kind = (process.env.INBOUND_EMAIL_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeInboundEmailAdapter();
      return cached;
    case 'imap':
      cached = new ImapInboundEmailAdapter();
      return cached;
    default:
      throw new Error(`Unknown INBOUND_EMAIL_ADAPTER value: ${kind}`);
  }
}

export function __resetInboundEmailAdapter(): void {
  cached = null;
}

export type { InboundEmailAdapter, InboundEmailDto, InboundEmailFetchResult } from './adapter';
