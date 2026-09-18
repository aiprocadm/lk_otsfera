import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource } from './helpers/source';

/**
 * `У-261` (дефект `Д-47`) — роль в партнёрстве бывает только `admin` или
 * `manager`.
 *
 * Что было. В `admin/users/mutations.ts` членство создавалось со значением
 * `'member'` — словом, которого нет ни в одном контракте: сервис партнёрской
 * команды объявляет `'admin' | 'manager'`, форма принимает эти же два, а
 * сборка сессии трактует «не admin» как `manager`.
 *
 * **Дыры в доступе это не создавало** — и именно поэтому прожило долго:
 * человек с `'member'` работал как менеджер, всё выглядело правильно. Врали
 * данные: выборка «кто у партнёра менеджер» такую строку не находила, и
 * отчёты считали людей мимо.
 *
 * Почему страж по тексту, а не тип. В схеме поле объявлено как `String` —
 * компилятор здесь бессилен, любое слово пройдёт. Значение пишется литералом,
 * поэтому литералы и проверяем: перечисляем все записи `roleInPartner: '…'` в
 * боевом коде и требуем, чтобы каждая была из двух разрешённых.
 */
const REPO_ROOT = join(__dirname, '..', '..');
const SRC = join(REPO_ROOT, 'src');

/** Единственные допустимые значения. Третьего не бывает. */
const ALLOWED = ['admin', 'manager'];

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'e2e') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      productionFiles(full, out);
      continue;
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

type Bad = { file: string; value: string };

function findBadWrites(): Bad[] {
  const bad: Bad[] = [];
  for (const file of productionFiles(SRC)) {
    const src = readSource(file);
    for (const m of src.matchAll(/roleInPartner\s*:\s*'([^']*)'/g)) {
      const value = m[1] ?? '';
      if (!ALLOWED.includes(value)) bad.push({ file: relative(REPO_ROOT, file), value });
    }
  }
  return bad;
}

describe('роль в партнёрстве: только admin или manager (У-261)', () => {
  it('страж вообще что-то нашёл (иначе проверка ничего не значит)', () => {
    // Записи и сравнения в коде есть точно — если их ноль, сломался разбор,
    // а не код стал чище.
    const total = productionFiles(SRC)
      .map((f) => readSource(f))
      .join('\n')
      .match(/roleInPartner\s*:\s*'[^']*'/g);
    expect(total?.length ?? 0, 'ни одной записи roleInPartner не найдено').toBeGreaterThan(2);
  });

  it('ни одного значения вне контракта', () => {
    const bad = findBadWrites();
    expect(
      bad,
      'В коде записывается роль в партнёрстве, которой не существует:\n' +
        bad.map((b) => `  ${b.file}: «${b.value}»`).join('\n') +
        `\n\nДопустимы только: ${ALLOWED.map((a) => `«${a}»`).join(', ')}.`
    ).toEqual([]);
  });
});
