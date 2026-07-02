/**
 * Трек D (D1): единый интерфейс каналов уведомлений.
 *
 * Канал = транспорт доставки (email / telegram / max / whatsapp) за общим
 * контрактом. Фан-ауты (org/manager/partner/core) собирают `ChannelPayload`
 * и отдают его диспетчеру; добавление нового канала — новая реализация
 * `NotificationChannel` + строка в реестре (`registry.ts`), места генерации
 * событий не меняются.
 */
import type {
  sendNotificationEmail,
  sendOrgDocumentPublishedEmail,
  sendOrgPaymentReceivedEmail,
  sendOrgManagerRepliedEmail,
  sendOrgOrderStatusChangedEmail,
  sendManagerCommentFromOrgEmail,
  sendManagerDocumentUploadedByOrgEmail,
  sendManagerDocumentUploadedByPartnerEmail,
  sendManagerOrderMarkedPaidBy1CEmail,
  sendManagerOrderStatusChangedEmail,
  sendPartnerDocumentPublishedEmail,
  sendCommissionReadyEmail,
} from '@/lib/email/send';

export type ChannelKey = 'email' | 'telegram' | 'max' | 'whatsapp';

type PropsOf<F> = F extends (args: infer A) => unknown ? Omit<A, 'to'> : never;

/**
 * Пропсы каждого email-шаблона, выведенные из сигнатур sender-функций
 * `send.tsx` (type-only импорт — рантайм-зависимости нет). Ключи обязаны
 * совпадать с реестром `EMAIL_TEMPLATES` в `email.ts` — несовпадение ловит
 * typecheck через `Record<EmailTemplateKey, …>`.
 */
export type EmailTemplatePropsMap = {
  notification: PropsOf<typeof sendNotificationEmail>;
  orgDocumentPublished: PropsOf<typeof sendOrgDocumentPublishedEmail>;
  orgPaymentReceived: PropsOf<typeof sendOrgPaymentReceivedEmail>;
  orgManagerReplied: PropsOf<typeof sendOrgManagerRepliedEmail>;
  orgOrderStatusChanged: PropsOf<typeof sendOrgOrderStatusChangedEmail>;
  managerCommentFromOrg: PropsOf<typeof sendManagerCommentFromOrgEmail>;
  managerDocumentUploadedByOrg: PropsOf<typeof sendManagerDocumentUploadedByOrgEmail>;
  managerDocumentUploadedByPartner: PropsOf<typeof sendManagerDocumentUploadedByPartnerEmail>;
  managerOrderMarkedPaidBy1C: PropsOf<typeof sendManagerOrderMarkedPaidBy1CEmail>;
  managerOrderStatusChanged: PropsOf<typeof sendManagerOrderStatusChangedEmail>;
  partnerDocumentPublished: PropsOf<typeof sendPartnerDocumentPublishedEmail>;
  commissionReady: PropsOf<typeof sendCommissionReadyEmail>;
};

export type EmailTemplateKey = keyof EmailTemplatePropsMap;

/**
 * Сериализуемая ссылка на email-контент: ключ шаблона + его props.
 * JSON-совместима (кладётся в BullMQ-job); email-канал резолвит ключ в ту же
 * sender-функцию, что вызывалась до рефакторинга — письма байт-в-байт.
 */
export type EmailContentRef = {
  [K in EmailTemplateKey]: { template: K; props: EmailTemplatePropsMap[K] };
}[EmailTemplateKey];

export type ChannelPayload = {
  /** Доменный тип уведомления (Notification.type — свободная строка). */
  type: string;
  title: string;
  body: string;
  url?: string;
  /**
   * Rich-email контент. Отсутствует → email-канал возвращает `skipped`
   * (in-app-only уведомления, например партнёрский lead_status_changed).
   */
  email?: EmailContentRef;
};

export type ChannelSendResult = {
  status: 'sent' | 'skipped' | 'failed';
  /** Стабильный код причины для skipped/failed (§3 CLAUDE.md). */
  reason?: string;
};

/**
 * Узкий select получателя — переиспользуется всеми фан-аутами, чтобы канал
 * гарантированно получил свои поля привязки. Трек D2 добавляет max/whatsapp
 * привязки и notificationChannels.
 */
export const CHANNEL_RECIPIENT_SELECT = {
  id: true,
  email: true,
  name: true,
  telegramChatId: true,
} as const;

export type ChannelRecipient = {
  id: string;
  email: string;
  name: string | null;
  telegramChatId: string | null;
};

export interface NotificationChannel {
  key: ChannelKey;
  /** Привязка (chatId/номер) + настройка пользователя + env/flag-гейт. */
  isEnabledFor(user: ChannelRecipient): boolean;
  send(user: ChannelRecipient, payload: ChannelPayload): Promise<ChannelSendResult>;
}
