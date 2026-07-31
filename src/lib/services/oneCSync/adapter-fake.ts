import { FAKE_ORGS } from './fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from './fixtures/orders';
import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor,
} from './dto';

function afterCursor<T extends { updatedAt: string }>(items: T[], cursor: SyncCursor): T[] {
  if (!cursor.since) return items;
  const sinceTs = Date.parse(cursor.since);
  return items.filter((item) => Date.parse(item.updatedAt) > sinceTs);
}

/**
 * When FAKE_ONEC_MALFORMED_RATE is set (0..1), appends a deliberately-invalid
 * record so tests can exercise the per-record validation quarantine. The output
 * is typed `unknown[]`-compatible; callers validate via schemas.
 */
function maybeInjectMalformed<T>(items: T[]): T[] {
  const rate = Number(process.env.FAKE_ONEC_MALFORMED_RATE);
  if (Number.isFinite(rate) && rate > 0) {
    const malformed = { externalId: 'fake-malformed', broken: true } as unknown as T;
    return [...items, malformed];
  }
  return items;
}

async function maybeLatency(): Promise<void> {
  const ms = Number(process.env.FAKE_ONEC_LATENCY_MS);
  if (Number.isFinite(ms) && ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export class FakeOneCAdapter implements OneCAdapter {
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_ORGS, cursor));
  }
  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_ORDERS, cursor));
  }
  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_PAYMENTS, cursor));
  }
  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_DOCUMENTS, cursor));
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    const failureRateStr = process.env.FAKE_ONEC_FAILURE_RATE;
    const failureRate = failureRateStr ? Number(failureRateStr) : 0;
    if (Number.isFinite(failureRate) && failureRate > 0 && Math.random() < failureRate) {
      throw new Error(
        `FakeOneC simulated failure (rate=${failureRate}) for lead ${payload.cabinetLeadId}`
      );
    }
    return { acceptedAt: new Date().toISOString(), oneCRequestId: `fake-req-${Date.now()}` };
  }
}
