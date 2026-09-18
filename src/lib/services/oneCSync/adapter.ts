import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  OneCDocumentPushPayload,
  OneCDocumentPushResult,
  OneCDebtDto,
  SyncCursor,
} from './dto';

/**
 * `У-257`: у канала нет такого метода — это НЕ сбой обмена.
 *
 * Метод `GET /api/debts` ожидает реализации на стороне 1С, а файловый канал
 * долгов не отдаёт в принципе. Отдельный класс ошибки нужен, чтобы сверка
 * сказала «метод не подключён» вместо «1С не отвечает»: второе заставило бы
 * администратора чинить работающий обмен.
 */
export class OneCMethodNotImplementedError extends Error {
  constructor(readonly method: string) {
    super(`1С не отвечает на метод ${method}: он ещё не реализован`);
    this.name = 'OneCMethodNotImplementedError';
  }
}

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
  /**
   * `У-257`: долги контрагентов на дату. Бросает
   * `OneCMethodNotImplementedError`, если канал метод не поддерживает, — сверка
   * различает «не подключено» и «не отвечает» и ведёт себя по-разному.
   */
  pullDebts(cursor: SyncCursor): Promise<OneCDebtDto[]>;
}
