import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { REPORTS, REPORT_ROW_LIMIT, isReportKey } from '@/lib/reports/registry';
import { ANALYTICS_TAB_KEYS } from '@/components/leader/analytics/analytics-tabs';
import { TAB_REPORT } from '@/components/leader/analytics/reports-export-panel';

/**
 * СТРАЖ `У-250` (этап 7): реестр отчётов ↔ вкладка «Экспорт».
 *
 * Отчёт существует, только если он в реестре: ключ, русское название,
 * объяснение словами, роли и колонки. Отчёт без колонок выгрузился бы пустым
 * файлом, отчёт без ролей — кому попало.
 *
 * Мутация (проверено): убрать роли у отчёта → «у каждого отчёта есть роли»
 * краснеет; убрать вкладку «Экспорт» из словаря → «вкладка существует»
 * краснеет; заменить отказ на усечение в `export.ts` → «предел — отказ, а не
 * усечение» краснеет; переименовать отчёт вкладки в `TAB_REPORT` → «у каждой
 * вкладки есть свой отчёт» краснеет.
 */
const SRC = join(process.cwd(), 'src');
const EXPORT_SRC = readSource(join(SRC, 'lib/reports/export.ts'));
const ROUTE_SRC = readSource(join(SRC, 'app/api/reports/[key]/export/route.ts'));

describe('страж: реестр отчётов полон и связан с экраном (У-250)', () => {
  it('в реестре есть отчёты и ключи не повторяются', () => {
    expect(REPORTS.length).toBeGreaterThanOrEqual(6);
    const keys = REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('у каждого отчёта есть название, объяснение, роли и колонки', () => {
    for (const r of REPORTS) {
      expect(r.title.length, `${r.key}: нет названия`).toBeGreaterThan(2);
      // Объяснение — то, что человек читает на вкладке «Экспорт».
      expect(r.hint.length, `${r.key}: объяснение слишком короткое`).toBeGreaterThan(20);
      expect(r.audiences.length, `${r.key}: отчёт без ролей доступен кому попало`).toBeGreaterThan(
        0
      );
      expect(r.columns.length, `${r.key}: отчёт без колонок выгрузится пустым`).toBeGreaterThan(1);
      for (const c of r.columns) {
        expect(c.header.length, `${r.key}/${c.key}: колонка без заголовка`).toBeGreaterThan(0);
      }
      const colKeys = r.columns.map((c) => c.key);
      expect(new Set(colKeys).size, `${r.key}: повтор колонки`).toBe(colKeys.length);
    }
  });

  it('вкладка «Экспорт» существует — иначе скачать отчёт неоткуда', () => {
    expect(ANALYTICS_TAB_KEYS).toContain('export');
  });

  it('у каждой вкладки, кроме «Экспорта», есть свой отчёт для скачивания', () => {
    for (const tab of ANALYTICS_TAB_KEYS) {
      // На «Экспорте» список целиком — отдельная кнопка там не нужна.
      if (tab === 'export') continue;
      const key = TAB_REPORT[tab];
      expect(key, `вкладка «${tab}»: скачать отчёт неоткуда`).toBeTruthy();
      expect(isReportKey(String(key)), `вкладка «${tab}»: отчёт «${key}» не из реестра`).toBe(true);
    }
  });

  it('неизвестный ключ распознаётся', () => {
    expect(isReportKey('receivables')).toBe(true);
    expect(isReportKey('выдуманный')).toBe(false);
  });

  it('предел строк — ОТКАЗ до выборки, а не молчаливое усечение', () => {
    expect(REPORT_ROW_LIMIT).toBe(50_000);
    // Сначала считаем, потом решаем: при переборе строки не читаются вовсе.
    const countAt = EXPORT_SRC.indexOf('await report.count(ctx)');
    const rowsAt = EXPORT_SRC.indexOf('await report.rows(ctx)');
    expect(countAt, 'счётчик строк пропал').toBeGreaterThan(-1);
    expect(rowsAt, 'выборка строк пропала').toBeGreaterThan(-1);
    expect(countAt, 'строки читаются раньше проверки предела').toBeLessThan(rowsAt);
    expect(EXPORT_SRC).toContain("error: 'too_many'");
    // Хвост «показаны первые N» — правило ПРЕЖНИХ выгрузок, здесь его быть не должно.
    expect(EXPORT_SRC).not.toContain('appendOverflowNotice');
  });

  it('право проверяется в маршруте ДО выборки', () => {
    const guardAt = ROUTE_SRC.indexOf('canRunReport(report, session)');
    const buildAt = ROUTE_SRC.indexOf('buildReportXlsx(');
    expect(guardAt, 'проверка права пропала из маршрута').toBeGreaterThan(-1);
    expect(guardAt, 'отчёт собирается раньше проверки права').toBeLessThan(buildAt);
  });
});
