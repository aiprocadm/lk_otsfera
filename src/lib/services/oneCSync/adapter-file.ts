import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import type { ImportDiagnostics } from '@/lib/services/import/diagnostics';
import { isValidInn, normalizeInn, synthOrgExternalId } from './inn';
import { translateFinancialStatus } from './translate';
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

const EPOCH = new Date(0).toISOString();

type FinStatus = OneCOrderDto['financialStatus'];
type ExecStatus = OneCOrderDto['executionStatus'];

function deriveFinStatus(total: number, paid: number, isRefund: boolean): FinStatus {
  /* v8 ignore next -- isRefund is always false at call sites in pullOrders; function signature preserved for future use */
  if (isRefund) return 'refunded';
  if (total <= 0) return 'not_billed';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'billed';
}

type RawOrg = {
  name?: unknown;
  inn?: unknown;
  kpp?: unknown;
  partnerInn?: unknown;
};

type RawOrder = {
  externalId: string;
  orderNumber: string | null;
  orgInn: string;
  totalAmount: number;
  paidAmount: number;
  financialStatusRaw?: string | null;
};

type RawPay = {
  externalId: string;
  orgInn: string;
  amount: number;
  paidAt: string;
  method: string | null;
  purpose: string | null;
  vatAmount: number | null;
  paymentOrderNumber: string | null;
  orderRef?: string | null;
};

export class FileOneCAdapter implements OneCAdapter {
  constructor(private readonly buffer: Buffer | ArrayBuffer) {}

  private parsed?: ReturnType<typeof parseWorkbook>;
  private sheets() {
    return (this.parsed ??= parseWorkbook(this.buffer));
  }

  /**
   * Что система увидела в книге (ТЗ починки импорта, Т-3): листы, ожидаемые
   * листы, нераспознанные заголовки.
   *
   * Метод намеренно НЕ входит в интерфейс `OneCAdapter`: у сетевого адаптера
   * никаких «листов книги» нет, и требовать от него заглушку — врать в типах.
   * Сервис импорта конструирует `FileOneCAdapter` напрямую и зовёт метод как
   * есть.
   */
  async diagnostics(): Promise<ImportDiagnostics> {
    const { diagnostics } = await this.sheets();
    return diagnostics;
  }

  /**
   * Контрагенты из листа «Контрагенты» (Т-15) — ядро починки: до этапа 5 метод
   * намеренно возвращал `[]`, и организации из файла не создавались вовсе (П-1).
   *
   * Ключ синтезируется из ИНН (Т-16): `1c-inn:<нормализованный ИНН>`. Строка
   * без валидного ИНН получает `externalId = наименование` — до writer'а её не
   * пустит файловая схема (`no_inn`/`bad_inn`), а в таблице ошибок оператор
   * увидит имя контрагента, а не прочерк.
   */
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    void cursor;
    const { orgs } = await this.sheets();
    const result: OneCOrgDto[] = [];
    for (const raw of orgs as RawOrg[]) {
      const name = raw?.name == null ? '' : String(raw.name).trim();
      if (!name) continue; // строки-итоги и пустые хвосты листа
      const inn = raw.inn == null ? '' : normalizeInn(String(raw.inn));
      const kpp = raw.kpp == null ? '' : String(raw.kpp).trim();
      const partnerRef = raw.partnerInn == null ? '' : String(raw.partnerInn).trim();
      result.push({
        externalId: inn && isValidInn(inn) ? synthOrgExternalId(inn) : name,
        name,
        ...(inn ? { inn } : {}),
        ...(kpp ? { kpp } : {}),
        ...(partnerRef ? { partnerExternalId: partnerRef } : {}),
        updatedAt: EPOCH,
      });
    }
    return result;
  }

  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    void cursor;
    return [];
  }

  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    void cursor;
    const { orders } = await this.sheets();
    const result: OneCOrderDto[] = [];
    for (const raw of orders as RawOrder[]) {
      if (!raw?.externalId || !raw?.orgInn) continue;
      const total = Number(raw.totalAmount) || 0;
      const paid = Number(raw.paidAmount) || 0;
      let fin: FinStatus = deriveFinStatus(total, paid, false);
      if (raw.financialStatusRaw) {
        const t = translateFinancialStatus(raw.financialStatusRaw);
        if (t.ok) fin = t.value;
      }
      const executionStatus: ExecStatus = 'pending';
      result.push({
        externalId: raw.externalId,
        orderNumber: raw.orderNumber ?? undefined,
        title: raw.orderNumber ?? raw.externalId,
        organizationInn: raw.orgInn,
        totalAmount: total,
        paidAmount: paid,
        vatIncluded: true,
        executionStatus,
        financialStatus: fin,
        productMix: [],
        updatedAt: EPOCH,
      });
    }
    return result;
  }

  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    void cursor;
    const { payments } = await this.sheets();
    const result: OneCPaymentDto[] = [];
    for (const raw of payments as RawPay[]) {
      if (!raw?.externalId || !raw?.orgInn) continue;
      const isRefund = /возврат/i.test(raw.method ?? '') || Number(raw.amount) < 0;
      const base = {
        externalId: raw.externalId,
        amount: Number(raw.amount) || 0,
        paidAt: raw.paidAt,
        method: raw.method ?? undefined,
        purpose: raw.purpose ?? undefined,
        paymentOrderNumber: raw.paymentOrderNumber ?? undefined,
        vatAmount: raw.vatAmount == null ? undefined : Number(raw.vatAmount),
        isRefund,
        updatedAt: EPOCH,
      };
      if (raw.orderRef) {
        result.push({ ...base, orderExternalId: raw.orderRef });
      } else {
        result.push({ ...base, organizationInn: raw.orgInn });
      }
    }
    return result;
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    void payload;
    throw new Error('FileOneCAdapter is read-only');
  }

  // Файловый адаптер читает книгу и наружу не пишет: выгрузка документов
  // файлом — отдельный канал (`У-173`, пакет Excel + ZIP), не этот метод.
  async pushDocument(payload: OneCDocumentPushPayload): Promise<OneCDocumentPushResult> {
    void payload;
    throw new Error('FileOneCAdapter is read-only');
  }

  // Этап 8 (`У-172`): по книге нельзя ответить, что в 1С есть, а чего нет, —
  // сверка через файловый канал невозможна. Именно исключение, а не `null`:
  // `null` значит «1С сказала: нет такого», и сверка молча пометила бы все
  // выгруженные документы пропавшими.
  async findDocument(externalId: string): Promise<OneCDocumentDto | null> {
    void externalId;
    throw new Error('FileOneCAdapter is read-only');
  }
}
