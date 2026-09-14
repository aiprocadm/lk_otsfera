import type { ChannelKey, ChannelPayload } from '@/lib/notifications/channels/types';

export type SyncJobPayload = {
  triggeredAt: string;
  reason?: 'cron' | 'webhook' | 'manual';
};

export type PushLeadJobPayload = {
  leadId: string;
};

/**
 * Этап 8 (`У-168`): выгрузка одного документа в 1С. `actorUserId` — кто попросил
 * (кнопка «Выгрузить») или чьим выпуском сработало правило `auto` (`У-169`);
 * от его имени пишется событие журнала аудита (`У-159`).
 */
export type PushDocumentJobPayload = {
  documentId: string;
  actorUserId?: string | undefined;
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

export type ScanDocumentTarget =
  | 'document'
  | 'leadAttachment'
  | 'inbound_attachment'
  | 'call_recording'
  | 'staff_attachment'
  | 'chat_attachment'
  | 'client_request_attachment'
  // Этап 5 (У-138): логотип/подпись/печать компании — id строки CompanyBrandingAsset.
  | 'company_branding';

export type ScanDocumentPayload = {
  kind: ScanDocumentTarget;
  id: string;
};

/**
 * Этап 2 (`У-193`, `У-194`): пакет миграции из Битрикс24. Что делать с пакетом,
 * говорит имя задачи (`job.name`): `preview` — сухой прогон со сводкой,
 * `apply` — запись, `rollback` — откат, `bitrix.resync` — еженедельный повтор
 * по расписанию. У первых трёх полезная нагрузка одна: всё остальное лежит в
 * строке `BitrixImportBatch` (настройки, таблицы сопоставления, счётчики),
 * чтобы задача и экран видели одно состояние.
 */
export type BitrixImportJobPayload =
  | { batchId: string }
  /**
   * Повтор по расписанию (`У-203`): пакета ещё нет, его заводит сама задача.
   * Полезная нагрузка приходит от планировщика расписаний — общая для всех
   * задач по cron.
   */
  | SyncJobPayload;
