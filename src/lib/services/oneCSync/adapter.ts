import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor
} from './dto';

export interface OneCAdapter {
  pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]>;
  pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]>;
  pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]>;
  pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]>;
  pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult>;
}
