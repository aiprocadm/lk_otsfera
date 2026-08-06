import type { ZodType } from 'zod';
import { parseRecords } from './resilience';

export type BatchSummary = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  failed: number;
  skips: Array<{ externalId: string; reason: string }>;
  invalids: Array<{ externalId: string | null; issue: string }>;
  failures: Array<{ externalId: string; error: string }>;
};

export function emptySummary(): BatchSummary {
  return {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    failed: 0,
    skips: [],
    invalids: [],
    failures: [],
  };
}

export async function runRecordBatch<T>(
  raw: unknown[],
  schema: ZodType<T>,
  getExternalId: (r: T) => string,
  // Promise<unknown>: writer'ы с этапа 8 возвращают WriteOutcome (Т-34) —
  // батчу результат не нужен, его собирает замыкание вызывающего.
  handler: (r: T, summary: BatchSummary) => Promise<unknown>
): Promise<BatchSummary> {
  const summary = emptySummary();
  summary.pulled = raw.length;

  const { valid, invalid } = parseRecords(schema, raw);
  summary.invalid = invalid.length;
  summary.invalids = invalid;

  for (const record of valid) {
    try {
      await handler(record, summary);
    } catch (err) {
      summary.failed += 1;
      summary.failures.push({
        externalId: getExternalId(record),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

export function batchStatus(summary: BatchSummary): 'success' | 'warn' {
  return summary.skipped + summary.invalid + summary.failed > 0 ? 'warn' : 'success';
}
