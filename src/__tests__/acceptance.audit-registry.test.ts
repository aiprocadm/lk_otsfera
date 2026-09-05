import { describe, it, expect } from 'vitest';
import {
  anchorsOf,
  guardTokensOf,
  classifyRow,
  lastDateOf,
  markChecked,
  parseAuditRows,
  ruDate,
  splitCells,
  type AuditRow,
} from '@/lib/acceptance/auditRegistry';

/**
 * Разбор реестра сверки `AUDIT.md` (`У-176`): чистые функции режима `audit`
 * скрипта `screen-acceptance`. Три фикстуры-строки: ровная строка с историей
 * сверок, строка с `|` внутри бэктиков, экранированным `\|`, стражем и лишней
 * ячейкой, строка без якорей и без даты.
 */

const PLAIN =
  '| `У-1` | На `/partner/portfolio/[orgId]/settings` формы нет | [settings/page.tsx](../../src/app/partner/portfolio/[orgId]/settings/page.tsx) — форма удалена | ✅ соответствует | 08.08.2026 · перепроверено 19.08.2026 |';

const TRICKY =
  '| `У-59` | Откат (`CHANNEL_OPS`: `excel` \\| `statement`), тип `\'a\' | \'b\'` | [rollback.ts](../../src/lib/services/import/rollback.ts) · страж `security.role-access-matrix.guardrail` · [test](../../src/__tests__/services.import.rollback.test.ts#L10) · [glossary](../glossary.md) · [MAINTENANCE.md](MAINTENANCE.md) | Факт в отдельной ячейке | ✅ соответствует (этап 7) | 11.08.2026 |';

const BARE = '| `У-176` | Полный drift-аудит выполнен | — | ⏳ этап 9 | — |';

const MD = ['## Блок', '', '| Требование | Что | Якорь | Вердикт | Сверено |', '|---|---|---|---|---|', PLAIN, TRICKY, BARE, '', 'текст'].join('\n');

describe('splitCells — ячейки с учётом бэктиков', () => {
  it('ровная строка даёт пять ячеек без пустых по краям', () => {
    expect(splitCells(PLAIN)).toHaveLength(5);
    expect(splitCells(PLAIN)[0]).toBe('`У-1`');
  });

  it('`|` в бэктиках и `\\|` не режут ячейку, а лишняя ячейка остаётся лишней', () => {
    const cells = splitCells(TRICKY);
    expect(cells).toHaveLength(6);
    expect(cells[1]).toContain("`'a' | 'b'`");
    expect(cells[1]).toContain('`excel` \\| `statement`');
    expect(cells[4]).toBe('✅ соответствует (этап 7)');
  });
});

describe('parseAuditRows', () => {
  const rows = parseAuditRows(MD);

  it('находит только строки требований, с номером строки файла', () => {
    expect(rows.map((r) => r.id)).toEqual(['У-1', 'У-59', 'У-176']);
    expect(rows.map((r) => r.line)).toEqual([5, 6, 7]);
  });

  it('вердикт и дата берутся с конца — строка с лишней ячейкой разбирается так же', () => {
    const tricky = rows[1] as AuditRow;
    expect(tricky.verdict).toBe('✅ соответствует (этап 7)');
    expect(tricky.checked).toBe('11.08.2026');
    expect(tricky.lastChecked).toBe('2026-08-11');
  });

  it('последняя сверка — самая поздняя дата колонки, а не первая', () => {
    expect((rows[0] as AuditRow).lastChecked).toBe('2026-08-19');
    expect(lastDateOf('09.08.2026 · починено 05.09.2026')).toBe('2026-09-05');
    expect(lastDateOf('—')).toBeNull();
  });

  it('якоря — пути от корня; `../x` → docs/x, голое имя → docs/tz/x, без #фрагмента', () => {
    const tricky = rows[1] as AuditRow;
    expect(tricky.anchors).toEqual([
      'src/lib/services/import/rollback.ts',
      'src/__tests__/services.import.rollback.test.ts',
      'docs/glossary.md',
      'docs/tz/MAINTENANCE.md',
    ]);
    expect(anchorsOf('[x](https://example.com) [y](#якорь)')).toEqual([]);
  });

  it('кандидаты в стражи — имена из бэктиков и якоря в src/__tests__/', () => {
    const tricky = rows[1] as AuditRow;
    expect(tricky.guardTokens).toEqual([
      'security.role-access-matrix.guardrail',
      'src/__tests__/services.import.rollback.test.ts',
    ]);
    // `CHANNEL_OPS` (заглавные) и `'a' | 'b'` — не имена тестов.
    expect(tricky.guardTokens).not.toContain('CHANNEL_OPS');
  });

  it('помощник в src/__tests__/helpers/ — не страж: vitest его не запускает', () => {
    const line =
      '| `У-2` | x | [envRegistry.ts](../../src/__tests__/helpers/envRegistry.ts) · [t](../../src/__tests__/a.b.test.tsx) | ✅ | 01.09.2026 |';
    expect(guardTokensOf(line, anchorsOf(line))).toEqual(['src/__tests__/a.b.test.tsx']);
  });

  it('строка без якорей и без даты: anchors пуст, lastChecked null', () => {
    const bare = rows[2] as AuditRow;
    expect(bare.anchors).toEqual([]);
    expect(bare.guardTokens).toEqual([]);
    expect(bare.lastChecked).toBeNull();
    expect(bare.verdict).toBe('⏳ этап 9');
  });
});

describe('classifyRow — группы drift-аудита', () => {
  const rows = parseAuditRows(MD);
  const [plain, tricky, bare] = rows as [AuditRow, AuditRow, AuditRow];
  const today = '2026-09-05';

  it('страж есть → guard, даже если якорь менялся', () => {
    expect(classifyRow(tricky, { today, guards: ['src/__tests__/x.test.ts'], changed: ['src/lib/services/import/rollback.ts'] })).toBe('guard');
  });

  it('стража нет: якорь не менялся → unchanged, менялся → changed', () => {
    expect(classifyRow(plain, { today, guards: [], changed: [] })).toBe('unchanged');
    expect(classifyRow(plain, { today, guards: [], changed: [plain.anchors[0] as string] })).toBe('changed');
  });

  it('якорей нет → manual; ни разу не сверялось, но якорь есть → changed', () => {
    expect(classifyRow(bare, { today, guards: [], changed: [] })).toBe('manual');
    expect(classifyRow({ ...bare, anchors: ['src/x.ts'] }, { today, guards: [], changed: [] })).toBe('changed');
  });

  it('сверено сегодня → fresh, без второй отметки за день', () => {
    expect(classifyRow({ ...plain, lastChecked: today }, { today, guards: ['g'], changed: [] })).toBe('fresh');
  });
});

describe('markChecked — отметка в колонке «Сверено»', () => {
  it('дописывает отметку через « · », историю не стирает, чужие строки не трогает', () => {
    const out = markChecked(MD, new Map([['У-1', 'якоря не менялись, 05.09.2026']]));
    const lines = out.split('\n');
    expect(lines[4]).toMatch(/\| 08\.08\.2026 · перепроверено 19\.08\.2026 · якоря не менялись, 05\.09\.2026 \|$/);
    expect(lines[5]).toBe(TRICKY);
    expect(lines[6]).toBe(BARE);
    expect(parseAuditRows(out).map((r) => r.lastChecked)).toEqual(['2026-09-05', '2026-08-11', null]);
  });

  it('пустая колонка «—» заменяется отметкой целиком', () => {
    const out = markChecked(MD, new Map([['У-176', 'проверено руками 05.09.2026']]));
    expect(out.split('\n')[6]).toBe('| `У-176` | Полный drift-аудит выполнен | — | ⏳ этап 9 | проверено руками 05.09.2026 |');
  });

  it('ruDate переводит ISO в формат колонки', () => {
    expect(ruDate('2026-09-05')).toBe('05.09.2026');
  });
});
