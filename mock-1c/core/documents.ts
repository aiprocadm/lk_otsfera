import { OneCDocumentPushSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCDocumentDto, OneCDocumentPushPayload } from '@/lib/services/oneCSync/dto';

// Этап 8 (`У-167`): приём исходящих документов кабинета — то, что настоящая 1С
// обязана делать по контракту (docs/integrations/1c-contract.md, секция 6 и
// «Идемпотентность»). Ключ хранения — `externalId` кабинета; поведение по
// версии: та же — no-op с тем же ответом, выше — обновление, ниже — 409.

export type DocumentAcceptResult =
  | { status: 200; result: { externalId: string }; error?: undefined }
  | { status: 400 | 409 | 500; result?: undefined; error: string };

type StoredDocument = {
  /** Идентификатор бумаги в «1С» — отдаётся кабинету и не меняется при обновлении. */
  oneCExternalId: string;
  version: number;
  body: OneCDocumentPushPayload;
  /** Сколько POST-ов принято по этому `externalId`, включая no-op повторы. */
  attempts: number;
  /** Когда «1С» приняла последнюю версию — это её `updatedAt` в ответе сверки. */
  acceptedAt: string;
};

export type DocumentStoreState = {
  uniqueDocuments: number;
  documents: Array<{
    externalId: string;
    oneCExternalId: string;
    type: OneCDocumentPushPayload['type'];
    number: string;
    version: number;
    attempts: number;
    lines: number | null;
  }>;
  lastBody: OneCDocumentPushPayload | null;
};

export function createDocumentStore() {
  const byExternalId = new Map<string, StoredDocument>();
  let lastBody: OneCDocumentPushPayload | null = null;
  let counter = 0;

  return {
    accept(body: unknown, pushFailRate: number): DocumentAcceptResult {
      // Deterministic failure when rate >= 1; probabilistic otherwise (mock runtime only).
      if (pushFailRate >= 1 || (pushFailRate > 0 && Math.random() < pushFailRate)) {
        return { status: 500, error: 'push failed' };
      }
      // Тело проверяется ТОЙ ЖЕ схемой, что описывает контракт: mock — это
      // контрактный тест, и «принял что попало» здесь хуже, чем 400.
      const parsed = OneCDocumentPushSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
          status: 400,
          error: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`,
        };
      }
      const doc = parsed.data;
      lastBody = doc;

      const existing = byExternalId.get(doc.externalId);
      if (existing) {
        existing.attempts += 1;
        if (doc.version === existing.version) {
          // Та же пара externalId + version — no-op: ничего не меняем, отвечаем тем же.
          return { status: 200, result: { externalId: existing.oneCExternalId } };
        }
        if (doc.version < existing.version) {
          return {
            status: 409,
            error: `version ${doc.version} is below accepted ${existing.version}`,
          };
        }
        existing.version = doc.version;
        existing.body = doc;
        existing.acceptedAt = new Date().toISOString();
        return { status: 200, result: { externalId: existing.oneCExternalId } };
      }

      counter += 1;
      const stored: StoredDocument = {
        oneCExternalId: `mock-doc-${counter}`,
        version: doc.version,
        body: doc,
        attempts: 1,
        acceptedAt: new Date().toISOString(),
      };
      byExternalId.set(doc.externalId, stored);
      return { status: 200, result: { externalId: stored.oneCExternalId } };
    },
    // Этап 8 (`У-172`): ответ на `GET /api/documents?externalId=` (контракт
    // §7) — принятая бумага в формате секции 4, как её отдала бы настоящая 1С:
    // под СВОИМ идентификатором, с направлением «выпущена кабинетом». Заказ
    // без `externalId` в 1С (заведён в кабинете) «1С» заводит у себя — как и
    // обещает контракт §6; у документа без заказа заказ выдуманный, потому
    // что секция 4 требует его всегда.
    find(externalId: string): OneCDocumentDto | null {
      const d = byExternalId.get(externalId);
      if (!d) return null;
      return {
        externalId: d.oneCExternalId,
        orderExternalId: d.body.order?.externalId ?? `mock-order-for-${d.oneCExternalId}`,
        type: d.body.type,
        direction: 'outgoing',
        number: d.body.number,
        name: `${d.body.type}-${d.body.number}.pdf`,
        mimeType: 'application/pdf',
        size: 0,
        downloadUrl: d.body.fileUrl,
        updatedAt: d.acceptedAt,
      };
    },
    state(): DocumentStoreState {
      return {
        uniqueDocuments: byExternalId.size,
        documents: [...byExternalId.entries()].map(([externalId, d]) => ({
          externalId,
          oneCExternalId: d.oneCExternalId,
          type: d.body.type,
          number: d.body.number,
          version: d.version,
          attempts: d.attempts,
          lines: d.body.lines === null ? null : d.body.lines.length,
        })),
        lastBody,
      };
    },
  };
}
