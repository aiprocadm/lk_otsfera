import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import React from 'react';
import { registerPdfFonts, PDF_FONT_FAMILY } from '@/lib/pdf/fonts';

/**
 * Этап 8 (ФТ-9.3/9.4, PR-2) — встроенные PDF-шаблоны счёта и акта (решение
 * §9-1: v1 без docx). Разметка через React.createElement (стиль
 * commission/pdf.ts); шрифт DejaVu — кириллица. Данные собирает
 * services/documents/generate.ts — рендер чистый и синхронный.
 */

export type PartyBlock = {
  displayName: string; // юр. название (фолбэк — рабочее название)
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
  phone?: string | null;
  email?: string | null;
};

export type OrderDocumentData = {
  docType: 'invoice' | 'act';
  number: string; // «С-2026-17» / «А-2026-17»
  date: Date;
  company: PartyBlock;
  organization: PartyBlock;
  orderLabel: string; // «Заказ №123: Обучение по ОТ»
  items: Array<{ name: string; amount: string }>;
  total: string;
  vatLine: string;
};

const e = React.createElement;

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 9, padding: 40, color: '#111' },
  title: { fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  subtitle: { fontSize: 9, color: '#555', marginBottom: 12 },
  bankBox: { borderWidth: 1, borderColor: '#111', marginBottom: 14 },
  bankRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#111' },
  bankCellLabel: { width: '55%', padding: 4, borderRightWidth: 0.5, borderRightColor: '#111' },
  bankCellValue: { width: '45%', padding: 4 },
  partyLabel: { fontSize: 8, color: '#888', marginTop: 8 },
  partyText: { fontSize: 9, marginTop: 1 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F3F4F6', padding: 5, marginTop: 14, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 4, paddingHorizontal: 5 },
  colN: { width: '6%' },
  colName: { width: '70%' },
  colAmount: { width: '24%', textAlign: 'right' },
  totals: { marginTop: 8, alignItems: 'flex-end' },
  totalLine: { fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  vatLine: { fontSize: 9, color: '#444', marginTop: 1 },
  actNote: { fontSize: 9, marginTop: 14, lineHeight: 1.5 },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  signBlock: { width: '45%' },
  signRole: { fontSize: 8, color: '#888', marginBottom: 18 },
  signLine: { borderTopWidth: 0.5, borderTopColor: '#111', paddingTop: 3, fontSize: 8, color: '#444' }
});

function partyLine(p: PartyBlock): string {
  const bits = [p.displayName];
  if (p.inn) bits.push(`ИНН ${p.inn}`);
  if (p.kpp) bits.push(`КПП ${p.kpp}`);
  if (p.legalAddress) bits.push(p.legalAddress);
  if (p.phone) bits.push(`тел. ${p.phone}`);
  if (p.email) bits.push(p.email);
  return bits.join(', ');
}

function signerLabel(p: PartyBlock): string {
  if (!p.signerName) return '';
  return p.signerPosition ? `${p.signerPosition}: ${p.signerName}` : p.signerName;
}

function OrderDocumentPdf({ data }: { data: OrderDocumentData }) {
  const dateStr = new Date(data.date).toLocaleDateString('ru-RU');
  const isInvoice = data.docType === 'invoice';
  const c = data.company;

  const bankRows: Array<[string, string]> = [
    [`${c.bankName ?? ''} БИК ${c.bic ?? ''}`, `К/с ${c.corrAccount ?? ''}`],
    [`Получатель: ${c.displayName} ИНН ${c.inn ?? ''}${c.kpp ? ` КПП ${c.kpp}` : ''}`, `Р/с ${c.bankAccount ?? ''}`]
  ];

  return e(
    Document,
    {},
    e(
      Page,
      { size: 'A4', style: styles.page },
      // Банковская шапка — только у счёта.
      isInvoice
        ? e(
            View,
            { style: styles.bankBox },
            ...bankRows.map(([l, r], i) =>
              e(
                View,
                { key: String(i), style: i === bankRows.length - 1 ? [styles.bankRow, { borderBottomWidth: 0 }] : styles.bankRow },
                e(Text, { style: styles.bankCellLabel }, l),
                e(Text, { style: styles.bankCellValue }, r)
              )
            )
          )
        : null,
      e(Text, { style: styles.title }, `${isInvoice ? 'Счёт' : 'Акт'} № ${data.number} от ${dateStr}`),
      e(Text, { style: styles.subtitle }, data.orderLabel),
      e(Text, { style: styles.partyLabel }, 'ИСПОЛНИТЕЛЬ'),
      e(Text, { style: styles.partyText }, partyLine(data.company)),
      e(Text, { style: styles.partyLabel }, 'ЗАКАЗЧИК'),
      e(Text, { style: styles.partyText }, partyLine(data.organization)),
      e(
        View,
        { style: styles.tableHeader },
        e(Text, { style: styles.colN }, '№'),
        e(Text, { style: styles.colName }, isInvoice ? 'Наименование услуги' : 'Наименование выполненных услуг'),
        e(Text, { style: styles.colAmount }, 'Сумма, ₽')
      ),
      ...data.items.map((item, i) =>
        e(
          View,
          { key: String(i), style: styles.tableRow },
          e(Text, { style: styles.colN }, String(i + 1)),
          e(Text, { style: styles.colName }, item.name),
          e(Text, { style: styles.colAmount }, item.amount)
        )
      ),
      e(
        View,
        { style: styles.totals },
        e(Text, { style: styles.totalLine }, `Итого: ${data.total} ₽`),
        e(Text, { style: styles.vatLine }, data.vatLine)
      ),
      !isInvoice
        ? e(
            Text,
            { style: styles.actNote },
            'Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.'
          )
        : null,
      e(
        View,
        { style: styles.signatures },
        e(
          View,
          { style: styles.signBlock },
          e(Text, { style: styles.signRole }, 'Исполнитель'),
          e(Text, { style: styles.signLine }, signerLabel(data.company) || 'подпись')
        ),
        isInvoice
          ? null
          : e(
              View,
              { style: styles.signBlock },
              e(Text, { style: styles.signRole }, 'Заказчик'),
              e(Text, { style: styles.signLine }, signerLabel(data.organization) || 'подпись')
            )
      )
    )
  );
}

export async function renderOrderDocumentPdf(data: OrderDocumentData): Promise<Buffer> {
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(e(OrderDocumentPdf, { data }) as any);
}
