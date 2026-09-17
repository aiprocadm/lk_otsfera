import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ `У-231` (решение `Р-Э5-5`): запись `Notification` рождается в ОДНОМ
 * месте — `recordNotification` в `lib/notifications/core.ts`. До этапа 5
 * прямых вызовов `prisma.notification.create` было 27 в 20 файлах, и ни один
 * не знал о повторах; следующий продьюсер, написанный «как соседний», обошёл
 * бы дедуп, и никто бы не заметил.
 *
 * Исходники читаются через `readSource` (комментарии вырезаны), поэтому
 * закомментированный вызов не считается живым, а живой в комментарии не
 * прячется.
 *
 * Мутация (проверено 17.09.2026): вернуть `prisma.notification.create({…})` в
 * любой продьюсер → страж называет файл и строку.
 */

const SRC = join(process.cwd(), 'src');
const ALLOWED = new Set(['lib/notifications/core.ts']);
const RE = /\bnotification\s*\.\s*(create|createMany|upsert)\s*\(/g;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('страж: единственная точка создания уведомления (У-231)', () => {
  it('вне core.ts нет прямых notification.create/createMany/upsert', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, [])) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;
      const src = readSource(file);
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (RE.test(line)) offenders.push(`${rel}:${i + 1}`);
        RE.lastIndex = 0;
      });
    }
    expect(
      offenders,
      'прямой вызов создания Notification — используйте recordNotification из lib/notifications/core.ts'
    ).toEqual([]);
  });

  it('сама точка на месте: core.ts создаёт запись ровно одним вызовом', () => {
    const src = readSource(join(SRC, 'lib/notifications/core.ts'));
    const matches = src.match(RE) ?? [];
    expect(matches).toHaveLength(1);
    expect(src).toContain('export async function recordNotification(');
  });
});
