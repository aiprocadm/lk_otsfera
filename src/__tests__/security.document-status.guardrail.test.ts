import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-148` — поле `status` документа меняется ТОЛЬКО через
 * `services/documents/status.ts`.
 *
 * Матрица переходов защищает от невозможных состояний лишь до тех пор, пока
 * её кто-то спрашивает. Прямой `document.update({ data: { status } })` в
 * соседнем сервисе обойдёт её молча — и документ окажется, например,
 * «отправленным» после аннулирования. Страж ищет именно такие обходы.
 *
 * Исключения — сам сервис статусов (он и есть дверь) и миграции.
 */
const SRC = join(__dirname, '..');
const ALLOWED = new Set(['lib/services/documents/status.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('У-148: статус документа меняется только через сервис статусов', () => {
  it('нет прямых записей document.update со status мимо двери', () => {
    const files = walk(SRC);
    // Смок против пустого обхода: страж, которому нечего проверять, зелен
    // не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, 'utf-8');
      // Ищем запись поля `status:` в data-объекте обновления документа.
      // Узко: `document.update(`/`document.updateMany(` … `status:` в пределах
      // одного вызова.
      //
      // `updateMany` добавлен этапом 7 (`У-164`): ежедневная задача «истёк срок
      // КП» — ровно тот случай, где массовое обновление напрашивается само, а
      // страж, знающий только про `update(`, промолчал бы на нём. Пачкой
      // статус двигать нельзя не из вредности: матрица переходов проверяется
      // по КАЖДОМУ документу отдельно, и аудит тоже пишется по каждому —
      // одним `updateMany` в журнале не осталось бы ни строки.
      for (const m of src.matchAll(/document\.update(?:Many)?\(\s*\{[\s\S]{0,400}?\}\s*\)/g)) {
        if (/\bstatus:\s/.test(m[0])) {
          offenders.push(rel);
          break;
        }
      }
    }

    expect(
      offenders,
      'Статус документа пишется мимо `setDocumentStatus` — матрица переходов ' +
        'обойдена, документ может получить невозможное состояние:\n'
    ).toEqual([]);
  });
});
