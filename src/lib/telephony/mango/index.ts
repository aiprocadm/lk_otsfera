import { FakeMangoAdapter } from './adapter-fake';
import { RestMangoAdapter } from './adapter-rest';

export interface MangoAdapter {
  fetchRecording(recordingId: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  requestStats(range: { from: string; to: string }): Promise<{ key: string }>;
  fetchStatsResult(key: string): Promise<{ ready: boolean; rows: unknown[] }>;
  initiateCallback(input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }>;
}

let cached: MangoAdapter | null = null;

export function getMangoAdapter(): MangoAdapter {
  if (cached) return cached;
  const kind = (process.env.MANGO_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeMangoAdapter();
      return cached;
    case 'rest':
      cached = new RestMangoAdapter();
      return cached;
    default:
      throw new Error(`Unknown MANGO_ADAPTER value: ${kind}`);
  }
}

export function __resetMangoAdapter(): void {
  cached = null;
}
