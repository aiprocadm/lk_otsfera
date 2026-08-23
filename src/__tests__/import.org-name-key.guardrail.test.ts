import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `У-84`: Organization.nameKey пишется при КАЖДОМ создании и переименовании
// организации — протухший ключ молча ломает дедупликацию (`У-86`) и ступень
// матчера (`У-88`). Текстовый страж (по образцу import.no-second-writer):
//
// - файл с `organization.create(`/`.upsert(` обязан упоминать `nameKey`
//   (создание всегда задаёт name);
// - файл с `organization.update(` и голым `name:` в значении (не `name: true`
//   из select и не `name: string` из типа) — тоже: он переименовывает.
//
// Ограничение по построению: guard видит только литерал `name:` в том же
// файле; запись через объект, собранный в другом модуле, он не поймает —
// такие места закрываются юнит-тестами payload'ов.
const ROOTS = ['src/lib', 'src/server-actions', 'src/app', 'src/worker'];

function collectTs(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    if (statSync(p).isDirectory()) {
      out.push(...collectTs(p));
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

describe('Organization.nameKey пишут все точки записи name (У-84)', () => {
  it('каждый писатель organization.create/upsert/update-с-name знает про nameKey', () => {
    const files = ROOTS.flatMap((r) => collectTs(join(process.cwd(), r)));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const creates = /\.organization\.(create|upsert)\(/.test(src);
      // Лукахед стоит сразу после двоеточия и сам съедает пробелы: вариант
      // `name\s*:\s*(?!true)` дыряв — `\s*` отступает и лукахед видит пробел.
      const renames =
        /\.organization\.update(Many)?\(/.test(src) &&
        /(^|[^A-Za-zА-Яа-я])name\s*:(?!\s*(?:true|string)\b)/m.test(src);
      if ((creates || renames) && !src.includes('nameKey')) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
