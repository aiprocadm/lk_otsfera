import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  renderCertificatesXlsx,
  CERTIFICATES_EXPORT_LIMIT,
} from '@/lib/services/certificates/xlsx';
import type { CertificateRow } from '@/lib/services/training/certificates';

/**
 * Этап 3 PR-2 (ФТ-6.5/ФТ-12.1): xlsx-рендерер реестра — колонки (± «Организация»),
 * русские статусы, «бессрочно»/«готовится», формула-инъекция, лимит строк.
 */

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-07-24T12:00:00');

const row = (over: Partial<CertificateRow> = {}): CertificateRow =>
  ({
    id: 'c1',
    number: 'УД-001',
    issuedAt: new Date('2026-01-10'),
    validUntil: new Date(NOW.getTime() + 200 * DAY),
    documentId: 'doc1',
    student: { id: 's1', name: 'Иванов Иван' },
    direction: { id: 'd1', name: 'Охрана труда' },
    organization: { id: 'o1', name: 'ООО Ромашка' },
    ...over,
  }) as never as CertificateRow;

async function parse(buf: ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb.worksheets[0];
}

function headerValues(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(1).eachCell((c) => out.push(String(c.value)));
  return out;
}

describe('renderCertificatesXlsx', () => {
  it('без организации: колонки реестра, статусы по-русски, скан «есть»', async () => {
    const ws = await parse(
      await renderCertificatesXlsx({ rows: [row()], total: 1, showOrganization: false, now: NOW })
    );
    expect(headerValues(ws)).toEqual([
      '№',
      'Сотрудник',
      'Направление',
      'Номер',
      'Выдано',
      'Действует до',
      'Статус',
      'Скан',
    ]);
    const r2 = ws.getRow(2);
    expect(String(r2.getCell(2).value)).toBe('Иванов Иван');
    expect(String(r2.getCell(7).value)).toBe('Действует');
    expect(String(r2.getCell(8).value)).toBe('есть');
  });

  it('с организацией: +колонка; истёкшее/истекающее/бессрочное и «готовится»', async () => {
    const ws = await parse(
      await renderCertificatesXlsx({
        rows: [
          row({ id: 'a', validUntil: new Date(NOW.getTime() - 3 * DAY) }),
          row({ id: 'b', validUntil: new Date(NOW.getTime() + 5 * DAY) }),
          row({ id: 'c', validUntil: null, documentId: null }),
        ],
        total: 3,
        showOrganization: true,
        now: NOW,
      })
    );
    expect(headerValues(ws)).toContain('Организация');
    expect(String(ws.getRow(2).getCell(8).value)).toBe('Истекло');
    expect(String(ws.getRow(3).getCell(8).value)).toBe('Истекает');
    const perpetual = ws.getRow(4);
    expect(String(perpetual.getCell(7).value)).toBe('бессрочно');
    expect(String(perpetual.getCell(8).value)).toBe('Действует');
    expect(String(perpetual.getCell(9).value)).toBe('готовится');
    expect(String(ws.getRow(2).getCell(3).value)).toBe('ООО Ромашка');
  });

  it('формула-инъекция: ведущий «=» экранируется одинарной кавычкой', async () => {
    const ws = await parse(
      await renderCertificatesXlsx({
        rows: [row({ student: { id: 's1', name: '=CMD()' }, number: '+SUM(A1)' } as never)],
        total: 1,
        showOrganization: false,
        now: NOW,
      })
    );
    expect(String(ws.getRow(2).getCell(2).value)).toBe("'=CMD()");
    expect(String(ws.getRow(2).getCell(4).value)).toBe("'+SUM(A1)");
  });

  it('total за лимитом → строка-предупреждение с числами', async () => {
    const ws = await parse(
      await renderCertificatesXlsx({
        rows: [row()],
        total: CERTIFICATES_EXPORT_LIMIT + 5,
        showOrganization: false,
        now: NOW,
      })
    );
    let warning = '';
    ws.eachRow((r) => {
      r.eachCell((c) => {
        if (String(c.value).includes('Показаны первые')) warning = String(c.value);
      });
    });
    expect(warning).toContain(String(CERTIFICATES_EXPORT_LIMIT));
    expect(warning).toContain(String(CERTIFICATES_EXPORT_LIMIT + 5));
  });
});
