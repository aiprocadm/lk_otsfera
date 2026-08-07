import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('import/ has no second writer (all writes via oneCSync writers)', () => {
  it('contains no direct prisma order/payment/organization/document create-or-update', () => {
    const dir = join(process.cwd(), 'src/lib/services/import');
    // Этап 9 (Т-35): откат — сознательный ОБРАТНЫЙ writer. Он восстанавливает
    // поля из снимков истории (`before`) и удаляет созданное импортом; прогон
    // через oneCSync-writer'ы превратил бы откат в новый импорт (со своей
    // историей, скоупами и счётчиками). Единственное санкционированное
    // исключение; любые другие прямые записи в import/ по-прежнему запрещены.
    const ALLOWED = new Set(['rollback.ts']);
    // Recursive: subdirectories (e.g. oneCAccountCard/) carry real write logic and
    // must be covered too — a non-recursive scan would silently exempt them.
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      if (/\.(order|payment|organization|document)\.(create|update|upsert)\b/.test(src))
        offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
