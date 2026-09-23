import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { CommissionStatement } from '@prisma/client';

/**
 * Прогон сопровождения №36, группа Б спеки
 * `2026-09-23-moscow-time-in-server-code`: подпись периода и дата
 * «Сформировано» в денежных документах ведомости — по Москве.
 *
 * Границы периода — ровно те, что пишет расчёт
 * (`worker/processors/calculate-monthly-commissions.ts`): начало — московская
 * полночь 1-го, конец — миг до московской полуночи 1-го следующего месяца.
 * Прежняя подпись сравнивала месяцы по часам процесса (UTC) и печатала за
 * август «31.07.2026 — 31.08.2026», за январь — «31.12.2025 — 31.01.2026».
 *
 * PDF проверяется по дереву элементов, а не по байтам: в файле текст сжат и
 * разрезан на глифы, а дерево — ровно то, что уйдёт в `renderToBuffer`.
 */
const { renderToBuffer } = vi.hoisted(() => ({
  renderToBuffer: vi.fn<(el: unknown) => Promise<Buffer>>(async () => Buffer.from('%PDF-1.4')),
}));
vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  renderToBuffer,
}));

import { renderStatementPdf } from '@/lib/services/commission/pdf';
import { renderStatementXlsx } from '@/lib/services/commission/xlsx';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';

const AUGUST = {
  periodFrom: new Date('2026-07-31T21:00:00.000Z'), // 01.08.2026 00:00 МСК
  periodTo: new Date('2026-08-31T20:59:59.999Z'), // 31.08.2026 23:59:59.999 МСК
};
const JANUARY = {
  periodFrom: new Date('2025-12-31T21:00:00.000Z'), // 01.01.2026 00:00 МСК
  periodTo: new Date('2026-01-31T20:59:59.999Z'),
};
// Ручной пересчёт ночью: 05.09.2026 00:30 по Москве — по Гринвичу ещё 04.09.
const NIGHT_RECALC = new Date('2026-09-04T21:30:00.000Z');

function statement(period: { periodFrom: Date; periodTo: Date }): CommissionStatement {
  return {
    id: 'stmt-msk',
    partnerId: 'p1',
    ...period,
    calculatedAt: NIGHT_RECALC,
    totalBaseAmount: 100000,
    averageRate: 0.1,
    totalCommissionAmount: 10000,
    status: 'draft',
  } as unknown as CommissionStatement;
}

/** Все строки дерева: заголовок документа и тексты всех узлов. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) texts(child, out);
  } else if (React.isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.type === 'function') {
      // Компонент документа — раскрываем его вызовом, как это сделал бы рендер.
      return texts((node.type as (p: unknown) => unknown)(node.props), out);
    }
    if (typeof node.props.title === 'string') out.push(node.props.title);
    texts(node.props.children, out);
  }
  return out;
}

async function pdfTexts(stmt: CommissionStatement): Promise<string[]> {
  await renderStatementPdf({
    statement: stmt,
    items: [],
    partner: { name: 'ПромТест', legalName: null },
    verifyUrl: null,
  });
  return texts(renderToBuffer.mock.calls[0]?.[0]);
}

async function summary(stmt: CommissionStatement): Promise<Map<string, unknown>> {
  const buf = await renderStatementXlsx({ statement: stmt, items: [], partner: { name: 'П' } });
  const wb = await loadXlsxWorkbook(buf);
  const rows = new Map<string, unknown>();
  wb.getWorksheet('Summary')?.eachRow((row) => {
    rows.set(String(row.getCell(1).value), row.getCell(2).value);
  });
  return rows;
}

describe('ведомость комиссии в PDF — период и дата по Москве', () => {
  beforeEach(() => renderToBuffer.mockClear());

  it('август по московским границам — «август 2026», а не «31.07.2026 — 31.08.2026»', async () => {
    const all = await pdfTexts(statement(AUGUST));
    expect(all).toContain('За период: август 2026');
    expect(all).toContain('Комиссионный отчёт — ПромТест — август 2026');
    expect(all.join('\n')).not.toContain('31.07.2026');
  });

  it('январь — «январь 2026», а не прошлый год', async () => {
    const all = await pdfTexts(statement(JANUARY));
    expect(all).toContain('За период: январь 2026');
    expect(all.join('\n')).not.toContain('2025');
  });

  it('«Сформировано» ночью по Москве — сегодняшнее московское число', async () => {
    const all = await pdfTexts(statement(AUGUST));
    expect(all).toContain('Сформировано: 05.09.2026');
    expect(all).toContain('05.09.2026'); // подвал страницы
  });
});

describe('ведомость комиссии в XLSX — период и дата по Москве', () => {
  it('август — «август 2026», январь — «январь 2026»', async () => {
    expect((await summary(statement(AUGUST))).get('Период')).toBe('август 2026');
    expect((await summary(statement(JANUARY))).get('Период')).toBe('январь 2026');
  });

  it('«Сформировано» ночью по Москве — сегодняшнее московское число', async () => {
    expect((await summary(statement(AUGUST))).get('Сформировано')).toBe('05.09.2026');
  });
});
