import { randomUUID } from 'node:crypto';
import type { MangoAdapter } from './index';

/**
 * Deterministic, network-free adapter for tests and local dev.
 *
 * `fetchRecording` returns the decoded FAKE_MANGO_RECORDING (base64) when set,
 * simulating "no recording" (null) otherwise. `requestStats`/`fetchStatsResult`
 * simulate an async stats job with the result supplied via FAKE_MANGO_STATS
 * (JSON array of rows), defaulting to [].
 */
export class FakeMangoAdapter implements MangoAdapter {
  async fetchRecording(recordingId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    void recordingId;
    const raw = process.env.FAKE_MANGO_RECORDING;
    if (!raw) return null;
    return { buffer: Buffer.from(raw, 'base64'), contentType: 'audio/mpeg' };
  }

  async requestStats(range: { from: string; to: string }): Promise<{ key: string }> {
    return { key: `fake-stats-key:${range.from}:${range.to}` };
  }

  async fetchStatsResult(key: string): Promise<{ ready: boolean; rows: unknown[] }> {
    void key;
    return { ready: true, rows: readStatsFixture() };
  }

  async initiateCallback(input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }> {
    void input;
    return { commandId: `fake-cmd-${randomUUID()}` };
  }
}

function readStatsFixture(): unknown[] {
  const raw = process.env.FAKE_MANGO_STATS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
