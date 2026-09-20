/**
 * Вкладка «Экспорт» и кнопка выгрузки над вкладкой (`У-244`).
 *
 * Два обещания. **Выгрузка — обычная ссылка, а не кнопка со скриптом:** файл
 * скачивается переходом, работает без JavaScript и кладётся в закладки вместе
 * с периодом. И **пустой список объясняет, почему он пуст** (`У-74`, §15):
 * «ничего нет» без причины оставляет человека гадать, сломалось ли что-то.
 *
 * Период уходит в адрес как есть — иначе человек скачал бы файл не за тот
 * месяц, который видит на экране.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  ReportsExportPanel,
  TabExportLink,
  TAB_REPORT,
} from '@/components/leader/analytics/reports-export-panel';

const QUERY = { from: '2026-09-01', to: '2026-09-30', companyId: 'c1' };

const html = (node: React.ReactElement) => renderToString(node).replace(/<!-- -->/g, '');

describe('Список отчётов', () => {
  it('пустой список говорит, почему он пуст и к кому идти', () => {
    const out = html(<ReportsExportPanel reports={[]} query={QUERY} />);

    expect(out).toContain('Отчётов для выгрузки нет');
    expect(out).toContain('Обратитесь к руководителю или администратору');
    // Ссылок быть не должно вовсе: скачивать нечего.
    expect(out).not.toContain('/api/reports/');
  });

  it('каждый отчёт — своя ссылка с названием, пояснением и периодом', () => {
    const out = html(
      <ReportsExportPanel
        reports={[
          { key: 'receivables', title: 'Дебиторка', hint: 'Кто и сколько должен' },
          { key: 'plan_fact', title: 'План-факт', hint: 'План против факта по менеджерам' },
        ]}
        query={QUERY}
      />
    );

    expect(out).toContain('Дебиторка');
    expect(out).toContain('Кто и сколько должен');
    expect(out).toContain(
      'href="/api/reports/receivables/export?from=2026-09-01&amp;to=2026-09-30&amp;companyId=c1"'
    );
    expect(out).toContain('href="/api/reports/plan_fact/export?from=2026-09-01');
    // Честное предупреждение про предел строк — до нажатия, а не после.
    expect(out).toContain('обрезанный отчёт не отдаём');
  });

  it('период без значений даёт ссылку без хвоста, а не «?undefined»', () => {
    const out = html(
      <ReportsExportPanel
        reports={[{ key: 'funnel_by_source', title: 'Воронка', hint: '—' }]}
        query={{}}
      />
    );

    expect(out).toContain('href="/api/reports/funnel_by_source/export?"');
    expect(out).not.toContain('undefined');
  });
});

describe('Кнопка над вкладкой', () => {
  it('ведёт на ту же выгрузку, что и список', () => {
    const out = html(<TabExportLink reportKey="communications" query={QUERY} />);

    expect(out).toContain(
      'href="/api/reports/communications/export?from=2026-09-01&amp;to=2026-09-30&amp;companyId=c1"'
    );
    expect(out).toContain('Скачать XLSX');
  });

  it.each(Object.entries(TAB_REPORT))('вкладке «%s» соответствует отчёт «%s»', (tab, report) => {
    // Реестр «вкладка → отчёт» держит обещание §15: человек смотрит на цифры и
    // скачивает ИХ ЖЕ, не уходя искать отчёт по названию на другой вкладке.
    expect(typeof tab).toBe('string');
    expect(html(<TabExportLink reportKey={report} query={{}} />)).toContain(
      `data-testid="tab-download-${report}"`
    );
  });
});
