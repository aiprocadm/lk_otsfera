import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Действующие документы не ссылаются в никуда и не носят чужих путей.
 *
 * Рабочий чеклист приёмки и runbook раскатки читают руками, по шагам. Ссылка,
 * которая никуда не ведёт, тратит время того, кто по ней пошёл, а абсолютный
 * путь вида `C:/Users/<имя>/…` вообще открывается только у автора: три таких
 * ссылки на файл памяти с чужой машины пролежали в `qa-staging-smoke-*.md` и
 * `runbook-staged-rollout-cabinets.md` до сопровождения (`С-7`, 06.09.2026,
 * хотфикс №14). Страж `docs.tz-program` проверяет ссылки только в
 * `MAINTENANCE.md` — остальные документы никто не сторожил.
 *
 * **Исторические планы и спеки (`docs/superpowers/**`) не проверяются
 * намеренно.** Это снимки на дату: файлы, на которые они ссылались, с тех пор
 * переехали, а править их §9.4 запрещает — страж требовал бы запрещённого.
 * По той же причине не проверяется раздел «Разведка по коду» в `STATUS.md`:
 * он помечен датой и коммитом (`92c683e`) и описывает прошлое.
 */
const ROOT = join(__dirname, '..', '..');
const DOCS = join(ROOT, 'docs');
/** Снимки на дату: править нельзя (§9.4), значит и сторожить нечего. */
const HISTORICAL_DIRS = [join('docs', 'superpowers')];
/** Разделы-снимки внутри живых файлов: заголовок → до следующего `## `. */
const HISTORICAL_SECTIONS: Array<{ file: string; heading: string }> = [
  { file: join('docs', 'tz', 'STATUS.md'), heading: '## Разведка по коду' },
];
/** Пути, которые существуют только на машине автора. */
const LOCAL_PATH = /\]\(\s*(?:\.\.\/)*(?:[A-Za-z]:[/\\]|\/home\/|\/Users\/)/;
const LINK = /\]\((?!https?:\/\/|mailto:)([^)#]+?)(?:#[^)]*)?\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

function isHistorical(file: string): boolean {
  const rel = relative(ROOT, file);
  return HISTORICAL_DIRS.some((d) => rel.startsWith(d + sep) || rel === d);
}

/** Текст файла без разделов-снимков — по ним страж не ходит. */
function liveText(file: string): string {
  const src = readFileSync(file, 'utf8');
  const cut = HISTORICAL_SECTIONS.find((h) => join(ROOT, h.file) === file);
  if (!cut) return src;
  const start = src.indexOf(cut.heading);
  if (start === -1) return src;
  const end = src.indexOf('\n## ', start + cut.heading.length);
  return src.slice(0, start) + (end === -1 ? '' : src.slice(end));
}

const liveDocs = walk(DOCS).filter((f) => !isHistorical(f));

describe('действующие документы: ссылки ведут туда, где что-то есть', () => {
  it('документы вообще находятся — обход не сломан', () => {
    // Страж без файлов зелёный не потому, что всё хорошо.
    expect(liveDocs.length).toBeGreaterThan(20);
  });

  it('ни одной ссылки на путь с конкретной машины', () => {
    const offenders = liveDocs
      .filter((f) => LOCAL_PATH.test(liveText(f)))
      .map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(
      offenders,
      'Ссылка на абсолютный путь вида `C:/Users/…` или `/home/…` открывается ' +
        'только у автора. Опиши документ словами или положи его в репозиторий:\n'
    ).toEqual([]);
  });

  it('ни одной относительной ссылки в никуда', () => {
    const dead: string[] = [];
    for (const file of liveDocs) {
      for (const m of liveText(file).matchAll(LINK)) {
        const raw = (m[1] ?? '').trim();
        if (!raw) continue;
        const target = normalize(join(dirname(file), decodeURIComponent(raw)));
        if (!existsSync(target)) {
          dead.push(`${relative(ROOT, file).split(sep).join('/')} → ${raw}`);
        }
      }
    }
    expect(
      dead,
      'Ссылка ведёт в никуда: файл переехал или его удалили. Поправь адрес ' +
        'или убери ссылку, оставив текст:\n' +
        dead.join('\n')
    ).toEqual([]);
  });

  it('каталоги-снимки исключены осознанно, а не потому, что их нет', () => {
    for (const d of HISTORICAL_DIRS) {
      const abs = join(ROOT, d);
      expect(existsSync(abs) && statSync(abs).isDirectory(), `${d}: каталога нет`).toBe(true);
    }
    for (const h of HISTORICAL_SECTIONS) {
      const abs = join(ROOT, h.file);
      expect(existsSync(abs), `${h.file}: файла нет`).toBe(true);
      expect(readFileSync(abs, 'utf8'), `${h.file}: раздела «${h.heading}» нет`).toContain(
        h.heading
      );
    }
  });
});
