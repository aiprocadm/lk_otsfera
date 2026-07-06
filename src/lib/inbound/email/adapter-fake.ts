import type { InboundEmailAdapter, InboundEmailDto, InboundEmailFetchResult } from './adapter';

/**
 * Deterministic, network-free adapter for tests and local dev.
 *
 * Messages are supplied via FAKE_INBOUND_EMAIL (JSON array of InboundEmailDto),
 * defaulting to []. The cursor is the count of messages already delivered
 * (as a string), so repeated calls with the same fixture + an advancing
 * cursor only return the newly-appended tail.
 */
export class FakeInboundEmailAdapter implements InboundEmailAdapter {
  async fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult> {
    const all = readFixture();
    const offset = cursor ? Number(cursor) : 0;
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const messages = all.slice(start);
    const newCursor = String(all.length);
    return { messages, cursor: newCursor };
  }
}

function readFixture(): InboundEmailDto[] {
  const raw = process.env.FAKE_INBOUND_EMAIL;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InboundEmailDto[]) : [];
  } catch {
    return [];
  }
}
