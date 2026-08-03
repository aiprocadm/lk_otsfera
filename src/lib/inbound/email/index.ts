import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { FakeInboundEmailAdapter } from './adapter-fake';
import { ImapInboundEmailAdapter } from './adapter-imap';
import type { InboundEmailAdapter } from './adapter';

// Синглтон кэшируется ПО ВИДУ адаптера (паттерн email/transport.ts): выбор
// `imap.adapter` редактируется в /admin/integrations — при смене значения
// (после prime кэша настроек) адаптер пересобирается без рестарта процесса.
let cached: InboundEmailAdapter | null = null;
let cachedForKind: string | null = null;

export function getInboundEmailAdapter(): InboundEmailAdapter {
  const kind = (cachedIntegrationSetting('imap.adapter') ?? 'fake').trim().toLowerCase();
  if (cached && cachedForKind === kind) return cached;
  switch (kind) {
    case 'fake':
      cached = new FakeInboundEmailAdapter();
      break;
    case 'imap':
      cached = new ImapInboundEmailAdapter();
      break;
    default:
      throw new Error(`Unknown INBOUND_EMAIL_ADAPTER value: ${kind}`);
  }
  cachedForKind = kind;
  return cached;
}

export function __resetInboundEmailAdapter(): void {
  cached = null;
  cachedForKind = null;
}

export type { InboundEmailAdapter } from './adapter';
