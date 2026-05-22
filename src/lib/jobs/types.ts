export type OneCEntity = 'order' | 'payment' | 'document' | 'organization' | 'lead';

export type SyncJobPayload = {
  triggeredAt: string;
  reason?: 'cron' | 'webhook' | 'manual';
};

export type PushLeadJobPayload = {
  leadId: string;
};

export type GenerateCommissionPdfPayload = {
  statementId: string;
};

export type GenerateCommissionXlsxPayload = {
  statementId: string;
};

export type NotificationDispatchPayload = {
  notificationId: string;
};

export type SendEmailPayload = {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, unknown>;
};
