/**
 * Email-канал (D1). Обёртка над существующим Resend-пайплайном `send.tsx`:
 * резолвит `EmailContentRef.template` в ту же типизированную sender-функцию,
 * что вызывалась фан-аутами до рефакторинга — контент писем и гейты
 * (`EMAIL_ENABLED`/`RESEND_API_KEY` внутри `send()`) не меняются.
 *
 * Email — базовый канал: всегда включён для пользователя с email,
 * пользовательской настройки отключения нет (ТЗ §12.1, трек D2).
 */
import {
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
  type SendResult,
} from '@/lib/email/send';
import { applyOverride, getTemplateOverride } from '@/lib/email/templateOverrides';
import type { EmailTemplateKey, NotificationChannel } from './types';

type EmailSender = (args: { to: string } & Record<string, unknown>) => Promise<SendResult>;

/**
 * Реестр шаблон-ключ → sender. Доступ к биндингам ленивый (стрелка на вызов):
 * тесты, мокающие '@/lib/email/send' частично, не обязаны определять все
 * exports — Vitest бросает на обращении к отсутствующему полю мока, а не на
 * построении реестра. Касты к `EmailSender` безопасны: тип props закреплён на
 * стороне конструирования `EmailContentRef` (см. types.ts).
 */
const EMAIL_TEMPLATES: Record<EmailTemplateKey, () => EmailSender> = {
  notification: () => sendNotificationEmail as EmailSender,
  orgDocumentPublished: () => sendOrgDocumentPublishedEmail as EmailSender,
  orgPaymentReceived: () => sendOrgPaymentReceivedEmail as EmailSender,
  orgManagerReplied: () => sendOrgManagerRepliedEmail as EmailSender,
  orgOrderStatusChanged: () => sendOrgOrderStatusChangedEmail as EmailSender,
  managerCommentFromOrg: () => sendManagerCommentFromOrgEmail as EmailSender,
  managerDocumentUploadedByOrg: () => sendManagerDocumentUploadedByOrgEmail as EmailSender,
  managerDocumentUploadedByPartner: () => sendManagerDocumentUploadedByPartnerEmail as EmailSender,
  managerOrderMarkedPaidBy1C: () => sendManagerOrderMarkedPaidBy1CEmail as EmailSender,
  managerOrderStatusChanged: () => sendManagerOrderStatusChangedEmail as EmailSender,
  partnerDocumentPublished: () => sendPartnerDocumentPublishedEmail as EmailSender,
  commissionReady: () => sendCommissionReadyEmail as EmailSender,
};

export const emailChannel: NotificationChannel = {
  key: 'email',
  isEnabledFor(user) {
    return !!user.email;
  },
  async send(user, payload) {
    if (!payload.email) {
      return { status: 'skipped', reason: 'no_email_content' };
    }
    const key = payload.email.template;
    const props = payload.email.props as Record<string, unknown>;

    // `У-128`: если тема и текст переопределены, письмо собирается из них —
    // но в ТОЙ ЖЕ вёрстке (`NotificationTemplate` поверх `layout.tsx`).
    // Иначе первое же отредактированное письмо потеряло бы фирменный вид.
    const { prisma } = await import('@/lib/db/prisma');
    const override = await getTemplateOverride(prisma, key, payload.companyId);
    if (override) {
      const { subject, text } = applyOverride(key, override, props);
      const result = await sendNotificationEmail({
        to: user.email,
        recipientName: user.name ?? 'коллега',
        title: subject,
        body: text,
        ...(typeof props.orderUrl === 'string' ? { url: props.orderUrl } : {}),
      });
      if (result.status === 'sent') return { status: 'sent' };
      return { status: 'skipped', reason: result.reason };
    }

    const sender = EMAIL_TEMPLATES[key]();
    const result = await sender({ to: user.email, ...props });
    if (result.status === 'sent') return { status: 'sent' };
    return { status: 'skipped', reason: result.reason };
  },
};
