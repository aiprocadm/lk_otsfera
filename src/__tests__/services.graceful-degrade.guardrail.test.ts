import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Сторож мягкой деградации (§3 CLAUDE.md).
 *
 * «Failures должны degrade gracefully: queue enqueue / notification fan-out —
 * логируем и проглатываем; они не должны блокировать основной путь.»
 *
 * Правило держалось на внимательности. И один раз не удержалось: в
 * `orderStatuses/transitions.ts` рассылка коллегам была обёрнута (с прямой
 * ссылкой на §3), а рассылка клиенту — нет, хотя стоит на десять строк выше.
 * Статус, история и аудит к тому моменту уже сохранены, поэтому сбой рассылки
 * показывал менеджеру ошибку по успешному действию, а повторное нажатие
 * оставляло второй след в истории.
 *
 * Проверка текстовая (AST здесь не нужен): ищем вызовы рассылки и постановки
 * задач, у которых рядом нет ни `try`, ни `.catch(`.
 */
const SRC = join(__dirname, '..');
const SKIP_DIRS = new Set(['__tests__', 'e2e']);

/** Вызовы, которые по §3 обязаны быть best-effort. */
const BEST_EFFORT = /\b(notifyManagers|notifyOrgUsers|notifyPartnerUsers)\s*\(|getQueue\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Открыт ли `try` выше по тексту (в пределах функции) или есть `.catch(` рядом. */
function isGuarded(lines: string[], idx: number): boolean {
  if (
    lines
      .slice(idx, idx + 12)
      .join('\n')
      .includes('.catch(')
  )
    return true;
  for (let i = idx; i >= Math.max(0, idx - 60); i--) {
    if (!/\btry\s*\{/.test(lines[i] as string)) continue;
    const chunk = lines.slice(i, idx + 1).join('\n');
    // try ещё не закрыт к моменту вызова — значит вызов внутри него
    if ((chunk.match(/\{/g) ?? []).length > (chunk.match(/\}/g) ?? []).length) return true;
  }
  return false;
}

/**
 * Места, где обёртка не нужна и её отсутствие осознанно.
 * Каждая строка — с причиной: список не должен превращаться в свалку.
 */
const ALLOWED = new Set<string>([
  // Реестр очередей и статистика: здесь очередь только объявляется/читается,
  // задачи не ставятся.
  'lib/jobs/queues.ts',
  'lib/services/admin/queueStats.ts',
  // Панель управления синхронизацией: постановка задачи — И ЕСТЬ основное
  // действие кнопки, её отказ обязан дойти до человека, а не потеряться.
  'lib/services/admin/syncControl.ts',
  // Диспетчер уведомлений сам является получателем этих сбоев.
  'lib/notifications/channels/dispatch.ts',
  // Разовый бэкфилл сканов: запускается руками, отказ должен быть виден.
  'lib/services/scan/backfill.ts',
  // Точка входа воркера: падение при старте — это и есть сигнал.
  'worker/index.ts',
]);

describe('рассылки и очереди не роняют основное действие (§3)', () => {
  it('у каждого вызова есть try или .catch', () => {
    const unguarded: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');

      lines.forEach((line, i) => {
        if (!BEST_EFFORT.test(line)) return;
        // Объявления, импорты и комментарии — не вызовы.
        if (/^\s*(import|export|\*|\/\/)/.test(line)) return;
        if (isGuarded(lines, i)) return;
        unguarded.push(`${rel}:${i + 1} — ${line.trim().slice(0, 70)}`);
      });
    }

    expect(unguarded, 'вызов без обёртки: сбой фона уронит основное действие').toEqual([]);
  });

  it('список исключений не разрастается молча', () => {
    // Каждое исключение стоит объяснить в комментарии рядом; если их станет
    // заметно больше — правило превратится в формальность.
    expect(ALLOWED.size).toBeLessThanOrEqual(8);
  });
});
