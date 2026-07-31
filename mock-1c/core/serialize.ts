import type { ScenarioConfig, StatusDialect, DatetimeFormat, EnvelopeShape } from './scenario';

type Rec = Record<string, unknown>;

// Q10: map our enum codes to plausible native-1С Russian stage names. These are
// deliberately NOT members of our z.enum — emitting them must trigger quarantine.
const EXECUTION_RU: Record<string, string> = {
  pending: 'Новый',
  in_progress: 'В работе',
  completed: 'Выполнен',
  cancelled: 'Отменён',
  on_hold: 'Приостановлен',
};
const FINANCIAL_RU: Record<string, string> = {
  not_billed: 'Не выставлен',
  billed: 'Выставлен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  refunded: 'Возврат',
};

export function applyDialect(record: Rec, dialect: StatusDialect): Rec {
  if (dialect !== 'russian') return record;
  const out: Rec = { ...record };
  if (typeof out.executionStatus === 'string' && out.executionStatus in EXECUTION_RU) {
    out.executionStatus = EXECUTION_RU[out.executionStatus];
  }
  if (typeof out.financialStatus === 'string' && out.financialStatus in FINANCIAL_RU) {
    out.financialStatus = FINANCIAL_RU[out.financialStatus];
  }
  return out;
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;
const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

export function applyDatetime(record: Rec, fmt: DatetimeFormat): Rec {
  if (fmt !== 'no-offset') return record;
  const out: Rec = { ...record };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && ISO_PREFIX.test(v)) out[k] = v.replace(OFFSET_SUFFIX, '');
  }
  return out;
}

export function injectMalformed(records: Rec[], rate: number): Rec[] {
  if (!(rate > 0)) return records;
  return [...records, { externalId: 'mock-malformed', broken: true }];
}

export function injectDuplicates(records: Rec[]): Rec[] {
  if (records.length === 0) return records;
  return [...records, { ...records[0] }];
}

export type ResponseMeta = { total: number; pages: number; served: number };

export function paginate(
  records: Rec[],
  pageSize: number,
  offset = 0
): { page: Rec[]; meta: ResponseMeta } {
  if (!(pageSize > 0) || records.length <= pageSize) {
    return {
      page: records,
      meta: { total: records.length, pages: records.length === 0 ? 0 : 1, served: records.length },
    };
  }
  const page = records.slice(offset, offset + pageSize);
  return {
    page,
    meta: {
      total: records.length,
      pages: Math.ceil(records.length / pageSize),
      served: page.length,
    },
  };
}

export function wrapEnvelope(records: Rec[], envelope: EnvelopeShape): unknown {
  if (envelope === 'items') return { items: records };
  if (envelope === 'other') return { data: records };
  return records;
}

// Compose all shaping in order. When paginating, return an { items, nextCursor }
// body and honour the caller's offset (opaque page cursor). nextCursor is the
// next offset, omitted on the last page so the client stops.
export function shapeResponse(
  records: Rec[],
  scenario: ScenarioConfig,
  offset = 0
): { body: unknown; meta: ResponseMeta } {
  let shaped = records
    .map((r) => applyDialect(r, scenario.statusDialect))
    .map((r) => applyDatetime(r, scenario.datetime));
  shaped = injectMalformed(shaped, scenario.malformedRate);
  if (scenario.duplicates) shaped = injectDuplicates(shaped);

  if (scenario.pageSize > 0 && shaped.length > scenario.pageSize) {
    const { page, meta } = paginate(shaped, scenario.pageSize, offset);
    const hasMore = offset + scenario.pageSize < shaped.length;
    const body = hasMore
      ? { items: page, nextCursor: String(offset + scenario.pageSize) }
      : { items: page };
    return { body, meta };
  }
  const { page, meta } = paginate(shaped, scenario.pageSize, offset);
  return { body: wrapEnvelope(page, scenario.envelope), meta };
}
