import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('import/ has no second writer (all writes via oneCSync writers)', () => {
  it('contains no direct prisma order/payment/organization/document create-or-update', () => {
    const dir = join(process.cwd(), 'src/lib/services/import');
    // Recursive: subdirectories (e.g. oneCAccountCard/) carry real write logic and
    // must be covered too — a non-recursive scan would silently exempt them.
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (/\.(order|payment|organization|document)\.(create|update|upsert)\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
