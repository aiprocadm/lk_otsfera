import type { ChannelKey, ChannelPayload } from '@/lib/notifications/channels/types';

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

/**
 * Job очереди `notifications.dispatch` (трек D5): доставка одного уведомления
 * одному получателю по одному каналу. Email-контент — сериализуемая ссылка на
 * шаблон; Date-props переживают JSON round-trip как ISO-строки и оживляются
 * процессором (whitelist в dispatch-notification.ts).
 */
export type NotificationDispatchPayload = {
  userId: string;
  channel: ChannelKey;
  payload: ChannelPayload;
};

export type SendEmailPayload = {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, unknown>;
};

export type ScanDocumentTarget = 'document' | 'leadAttachment';

export type ScanDocumentPayload = {
  kind: ScanDocumentTarget;
  id: string;
};
