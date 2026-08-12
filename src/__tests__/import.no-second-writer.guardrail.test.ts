import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('import/ has no second writer (all writes via oneCSync writers)', () => {
  it('contains no direct prisma order/payment/organization/document create-or-update', () => {
    const dir = join(process.cwd(), 'src/lib/services/import');
    // Санкционированные исключения; любые другие прямые записи в import/
    // по-прежнему запрещены:
    // - Этап 9 (Т-35): откат — сознательный ОБРАТНЫЙ writer. Он восстанавливает
    //   поля из снимков истории (`before`) и удаляет созданное импортом; прогон
    //   через oneCSync-writer'ы превратил бы откат в новый импорт (со своей
    //   историей, скоупами и счётчиками).
    // - Этап 10 (Т-30): создание организации из очереди — РУЧНАЯ операция по
    //   кнопке оператора, не импортная запись; oneCSync-writer создаёт
    //   организации только из данных 1С, а здесь источник — форма диалога.
    // - Этап 7 (`У-49`): автосоздание организации из выписки. Прежний запрет
    //   (Т-30а) отменён решением `Р-2`. Через oneCSync-writer это не идёт по
    //   той же причине, что и ручное создание: у строки выписки есть только
    //   название и ИНН плательщика, а не DTO контрагента из 1С с `externalId`.
    //   Правило компании (`У-50`) и запись в след батча (`У-59`) живут тут же —
    //   в writer'е их не выразить.
    const ALLOWED = new Set([
      'rollback.ts',
      join('oneCAccountCard', 'create-org.ts'),
      join('oneCAccountCard', 'auto-create.ts'),
    ]);
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
