import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor
} from './dto';
import { FAKE_ORGS } from './fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from './fixtures/orders';

function afterCursor<T extends { updatedAt: string }>(items: T[], cursor: SyncCursor): T[] {
  if (!cursor.since) return items;
  const sinceTs = Date.parse(cursor.since);
  return items.filter((item) => Date.parse(item.updatedAt) > sinceTs);
}

export class FakeOneCAdapter implements OneCAdapter {
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    return afterCursor(FAKE_ORGS, cursor);
  }

  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    return afterCursor(FAKE_ORDERS, cursor);
  }

  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    return afterCursor(FAKE_PAYMENTS, cursor);
  }

  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    return afterCursor(FAKE_DOCUMENTS, cursor);
  }

  async pushLead(_payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    return {
      acceptedAt: new Date().toISOString(),
      oneCRequestId: `fake-req-${Date.now()}`
    };
  }
}
