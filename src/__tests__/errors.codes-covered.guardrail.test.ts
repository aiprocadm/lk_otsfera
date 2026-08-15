import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { errorMessageRu } from '@/lib/errors/messages';

/**
 * Сторож русских текстов ошибок (§15 CLAUDE.md).
 *
 * «Коды (`forbidden`, `company_required`) — для API и логов; человек видит
 * строку из `errors/messages.ts` и понимает, что сделать.»
 *
 * Общий помощник показа ошибки устроен так: локальная карта экрана → общий
 * словарь → запасной вариант **`Ошибка: <код>`**. Последний и есть утечка:
 * код, которого нет ни там ни там, человек видит как есть.
 *
 * Текст допустим в двух местах, и это осознанно: общий словарь — для кодов,
 * которые звучат одинаково везде; локальная карта экрана — там, где нужна
 * формулировка по месту («Вернуть заявку на предыдущую стадию могут
 * администратор и руководитель»). Страж требует текст ХОТЬ ГДЕ-ТО.
 *
 * На момент заведения ни один код без текста до экрана не доходил — все
 * шестнадцать обрабатывались структурно (диалог со списком совпадений, код
 * HTTP). Но это свойство вызывающих, а не самих кодов: новый экран, честно
 * показавший ошибку общим помощником, выдал бы «Ошибка: access_denied».
 * Поэтому текст должен существовать заранее.
 */
const SRC = join(__dirname, '..');
const SERVICES = join(SRC, 'lib', 'services');

/** Пары «код: 'русский текст'» из локальных карт экранов. */
function localTranslations(): Set<string> {
  const out = new Set<string>();
  const stack = [join(SRC, 'components'), join(SRC, 'app')];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/([a-z0-9_]{3,}):\s*'[^']*[А-Яа-яЁё][^']*'/g)) {
        out.add(m[1] as string);
      }
    }
  }
  return out;
}

/** Коды из union-типов `error:` в сервисах (§3 — стабильные строки). */
function serviceErrorCodes(): Map<string, string> {
  const found = new Map<string, string>();
  const stack = [SERVICES];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!name.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/error:\s*((?:'[a-z0-9_]+'\s*\|?\s*)+)/g)) {
        for (const c of (m[1] as string).matchAll(/'([a-z0-9_]+)'/g)) {
          const code = c[1] as string;
          if (!found.has(code)) found.set(code, relative(SERVICES, p));
        }
      }
    }
  }
  return found;
}

describe('у каждого кода ошибки есть русский текст (§15)', () => {
  const codes = serviceErrorCodes();

  it('коды вообще находятся — разбор не сломан', () => {
    expect(codes.size).toBeGreaterThan(100);
    expect(codes.has('forbidden')).toBe(true);
  });

  it('ни один код сервиса не остался без русского текста', () => {
    const SENTINEL = '__нет_текста__';
    const local = localTranslations();
    const missing: string[] = [];

    for (const [code, file] of codes) {
      const inCentral = errorMessageRu(code, SENTINEL) !== SENTINEL;
      if (!inCentral && !local.has(code)) missing.push(`${code} (${file})`);
    }

    expect(missing, 'человек увидит технический код вместо объяснения').toEqual([]);
  });

  it('тексты общего словаря написаны для человека, а не для разработчика', () => {
    const SENTINEL = '__нет_текста__';
    for (const [code] of codes) {
      const text = errorMessageRu(code, SENTINEL);
      if (text === SENTINEL) continue; // переведён локально — проверяется выше
      expect(text, `${code}: текст должен быть на русском`).toMatch(/[А-Яа-яЁё]/);
      expect(text.length, `${code}: слишком короткий текст`).toBeGreaterThan(8);
    }
  });
});
