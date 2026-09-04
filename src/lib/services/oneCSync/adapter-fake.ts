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
  OneCDocumentPushPayload,
  OneCDocumentPushResult,
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

// FAKE_ONEC_FAILURE_RATE (0..1) роняет исходящие вызовы — так проверяют
// повторы очереди и запись ошибки без настоящей 1С. Общий для заявок и
// документов: сбой сети не выбирает, что именно не доставить.
function maybeFail(what: string): void {
  const failureRateStr = process.env.FAKE_ONEC_FAILURE_RATE;
  const failureRate = failureRateStr ? Number(failureRateStr) : 0;
  if (Number.isFinite(failureRate) && failureRate > 0 && Math.random() < failureRate) {
    throw new Error(`FakeOneC simulated failure (rate=${failureRate}) for ${what}`);
  }
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
    maybeFail(`lead ${payload.cabinetLeadId}`);
    return { acceptedAt: new Date().toISOString(), oneCRequestId: `fake-req-${Date.now()}` };
  }

  // Этап 8 (`У-167`): идентификатор в ответе ДЕТЕРМИНИРОВАННЫЙ — выводится из
  // `externalId` кабинета, а не из времени. Повтор той же версии обязан дать
  // тот же ответ (идемпотентность контракта), иначе тесты сервиса выгрузки
  // видели бы «новый документ в 1С» на каждом повторе.
  async pushDocument(payload: OneCDocumentPushPayload): Promise<OneCDocumentPushResult> {
    maybeFail(`document ${payload.externalId} v${payload.version}`);
    return { externalId: `1c-doc-${payload.externalId}` };
  }

  // Этап 8 (`У-172`): фейковая 1С ничего не теряет — на любой вопрос «есть
  // ли документ» отвечает «есть». Помнить принятые выгрузки нельзя: память
  // живёт до рестарта воркера, и «не помню — значит пропал» пометило бы на
  // стенде все документы `failed` после первого же перезапуска. Путь «в 1С
  // нет» проверяют подставной адаптер в тестах сервиса и mock-1c.
  async findDocument(externalId: string): Promise<OneCDocumentDto | null> {
    await maybeLatency();
    maybeFail(`find document ${externalId}`);
    return {
      externalId,
      orderExternalId: `fake-order-for-${externalId}`,
      type: 'invoice',
      direction: 'outgoing',
      name: `${externalId}.pdf`,
      mimeType: 'application/pdf',
      size: 0,
      downloadUrl: `https://fake-1c.local/documents/${externalId}.pdf`,
      updatedAt: new Date().toISOString(),
    };
  }
}
