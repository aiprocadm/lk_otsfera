import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import React from 'react';
import QRCode from 'qrcode';
import type { CommissionStatement, CommissionStatementItem } from '@prisma/client';

export type RenderStatementPdfArgs = {
  statement: CommissionStatement;
  items: CommissionStatementItem[];
  partner: { name: string; legalName: string | null };
  verifyUrl: string | null;
};

const BRAND = '#1E40AF'; // deep blue

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 40, color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  headerLeft: { flex: 1 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND, marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#555' },
  meta: { fontSize: 9, color: '#444', marginTop: 2 },
  sectionLabel: { fontSize: 8, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 16 },
  table: { width: '100%' },
  tableHeader: { flexDirection: 'row', backgroundColor: BRAND, color: '#fff', padding: 5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 4, paddingHorizontal: 5 },
  tableRowEven: { backgroundColor: '#F9FAFB' },
  col0: { width: '5%', textAlign: 'right' },
  col1: { width: '18%' },
  col2: { width: '35%' },
  col3: { width: '18%', textAlign: 'right' },
  col4: { width: '8%', textAlign: 'right' },
  col5: { width: '16%', textAlign: 'right' },
  colHeader: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8 },
  totalsRow: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: BRAND, paddingVertical: 5, paddingHorizontal: 5, marginTop: 2 },
  totalsLabel: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 9, color: BRAND },
  totalsValue: { width: '16%', textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 9, color: BRAND },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: '#aaa' },
  qrWrap: { position: 'absolute', bottom: 30, right: 40, alignItems: 'center' },
  qrImage: { width: 80, height: 80 },
  qrLabel: { fontSize: 6, color: '#888', marginTop: 2 },
});

function fmt(val: unknown): string {
  const n = Number(val);
  return isNaN(n) ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRate(val: unknown): string {
  const n = Number(val);
  return isNaN(n) ? '—' : (n * 100).toFixed(2) + '%';
}

function periodLabel(from: Date, to: Date): string {
  const months = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const f = new Date(from);
  const t = new Date(to);
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${months[f.getMonth()]} ${f.getFullYear()}`;
  }
  return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;
}

type StatementDocumentProps = RenderStatementPdfArgs & { qrDataUrl: string | null };

function StatementDocument({ statement, items, partner, qrDataUrl }: StatementDocumentProps) {
  const period = periodLabel(statement.periodFrom, statement.periodTo);
  const calculatedAtStr = new Date(statement.calculatedAt).toLocaleDateString('ru-RU');

  return React.createElement(
    Document,
    { title: `Комиссионный отчёт — ${partner.name} — ${period}` },
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      // Header
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(
          View,
          { style: styles.headerLeft },
          React.createElement(Text, { style: styles.title }, 'Отчёт по комиссии'),
          React.createElement(Text, { style: styles.subtitle }, `За период: ${period}`),
          React.createElement(Text, { style: styles.meta }, `Партнёр: ${partner.legalName ?? partner.name}`),
          React.createElement(Text, { style: styles.meta }, `Сформировано: ${calculatedAtStr}`)
        )
      ),
      // Section label
      React.createElement(Text, { style: styles.sectionLabel }, 'Детализация платежей'),
      // Table
      React.createElement(
        View,
        { style: styles.table },
        // Header row
        React.createElement(
          View,
          { style: styles.tableHeader },
          React.createElement(Text, { style: [styles.col0, styles.colHeader] }, '№'),
          React.createElement(Text, { style: [styles.col1, styles.colHeader] }, 'Заказ / платёж'),
          React.createElement(Text, { style: [styles.col2, styles.colHeader] }, 'Организация'),
          React.createElement(Text, { style: [styles.col3, styles.colHeader] }, 'База, ₽'),
          React.createElement(Text, { style: [styles.col4, styles.colHeader] }, 'Ставка'),
          React.createElement(Text, { style: [styles.col5, styles.colHeader] }, 'Комиссия, ₽')
        ),
        // Item rows
        ...items.map((item, idx) =>
          React.createElement(
            View,
            { key: item.id, style: [styles.tableRow, idx % 2 === 1 ? styles.tableRowEven : {}] },
            React.createElement(Text, { style: styles.col0 }, String(idx + 1)),
            React.createElement(Text, { style: styles.col1 }, item.orderNumber ?? '—'),
            React.createElement(Text, { style: styles.col2 }, item.organizationName),
            React.createElement(Text, { style: styles.col3 }, fmt(item.baseAmount)),
            React.createElement(Text, { style: styles.col4 }, fmtRate(item.rate)),
            React.createElement(Text, { style: styles.col5 }, fmt(item.commissionAmount))
          )
        ),
        // Totals row
        React.createElement(
          View,
          { style: styles.totalsRow },
          React.createElement(Text, { style: styles.totalsLabel }, 'Итого'),
          React.createElement(Text, { style: { width: '5%' } }, ''),
          React.createElement(Text, { style: { width: '18%' } }, ''),
          React.createElement(Text, { style: { width: '35%' } }, ''),
          React.createElement(Text, { style: { ...styles.totalsValue, width: '18%' } }, fmt(statement.totalBaseAmount)),
          React.createElement(Text, { style: { ...styles.totalsValue, width: '8%' } }, fmtRate(statement.averageRate)),
          React.createElement(Text, { style: styles.totalsValue }, fmt(statement.totalCommissionAmount))
        )
      ),
      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(Text, { style: styles.footerText }, 'Сформировано в личном кабинете «Промтехносфера»'),
        React.createElement(Text, { style: styles.footerText }, calculatedAtStr)
      ),
      // QR code in bottom-right corner (only when verifyUrl provided)
      qrDataUrl
        ? React.createElement(
            View,
            { style: styles.qrWrap },
            React.createElement(Image, { src: qrDataUrl, style: styles.qrImage }),
            React.createElement(Text, { style: styles.qrLabel }, 'Проверить отчёт')
          )
        : null
    )
  );
}

async function generateQrDataUrl(verifyUrl: string | null): Promise<string | null> {
  if (!verifyUrl) return null;
  try {
    return await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 160, // 2x of render size for retina-quality print
      color: { dark: '#111111', light: '#ffffff' },
    });
  } catch (err) {
    console.warn('[commission/pdf] QR generation failed; rendering PDF without it', {
      verifyUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function renderStatementPdf(args: RenderStatementPdfArgs): Promise<Buffer> {
  const qrDataUrl = await generateQrDataUrl(args.verifyUrl);
  const element = React.createElement(StatementDocument, { ...args, qrDataUrl });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any);
}
