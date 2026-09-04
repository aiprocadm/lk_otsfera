import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  OneCDocumentPushPayload,
  OneCDocumentPushResult,
  SyncCursor,
} from './dto';

export interface OneCAdapter {
  pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]>;
  pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]>;
  pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]>;
  pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]>;
  pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult>;
  /**
   * Этап 8 (`У-167`): выгрузка документа кабинета в 1С. Ответ — идентификатор
   * бумаги в 1С; ошибка транспорта или отказ 1С (`4xx`/`5xx`) — исключение,
   * которое сервис выгрузки записывает в `oneCPushError` и отдаёт очереди
   * на повтор.
   */
  pushDocument(payload: OneCDocumentPushPayload): Promise<OneCDocumentPushResult>;
  /**
   * Этап 8 (`У-172`): сверка — «а этот документ у тебя вообще есть?».
   * `externalId` — идентификатор кабинета (корень цепочки перевыпусков, тот
   * же, что ушёл в `pushDocument`). `null` — 1С честно ответила «нет такого»;
   * ошибка транспорта — исключение, и сверка НЕ считает документ пропавшим.
   */
  findDocument(externalId: string): Promise<OneCDocumentDto | null>;
}
