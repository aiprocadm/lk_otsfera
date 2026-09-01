import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import React from 'react';
import { registerPdfFonts, PDF_FONT_FAMILY } from '@/lib/pdf/fonts';
import type { ResolvedClause } from '@/lib/documents/documentTemplate';
import type { PartyBlock } from './orderDocumentPdf';
import { formatMoney, type PrintTable } from './printTable';
import type { DocumentBranding } from './branding';

/**
 * Этап 7 (`У-163`) — печать коммерческого предложения.
 *
 * **Почему отдельный файл, а не ветка в договоре.** У КП другой смысл и
 * другой лейаут: это письмо с ценой, а не соглашение сторон. У него нет
 * нумерованных разделов, нет реквизитов заказчика (адресата может не быть в
 * системе вовсе, `У-161`), нет двух подписей — вместо них подпись менеджера
 * с обратной связью. Ветка внутри договора означала бы `if (isProposal)` в
 * каждом втором блоке вёрстки.
 *
 * **Чего в КП НЕТ намеренно:**
 * - банковских реквизитов — по предложению не платят, платят по счёту;
 * - подписи заказчика — он ещё ничего не подписывает;
 * - печати организации — предложение не является документом строгой
 *   отчётности, а печать на нём создаёт видимость обязательства.
 *
 * Тексты («вводный» и «условия») приходят готовыми из реестра слотов
 * (`У-162`): вёрстка их не знает и не сочиняет — она печатает то, что дали.
 */

export type ProposalDocumentData = {
  number: string; // «КП-2026-4»
  date: Date;
  /** До какой даты действует предложение (`У-162`). */
  validUntil: Date | null;
  company: PartyBlock;
  /**
   * Кому адресовано. У КП лида организации в системе нет, поэтому здесь
   * ровно то, что о клиенте известно: название и, если есть, контактное лицо.
   * Полный `PartyBlock` тут был бы обещанием реквизитов, которых нет.
   */
  addressee: { name: string; contactName: string | null };
  /** Вводный текст и условия — уже с раскрытыми подстановками (`У-162`). */
  clauses: ResolvedClause[];
  /** Состав и итоги — тот же расчёт, что у счёта, акта и договора (`У-141`). */
  table: PrintTable;
  /** Логотип и подпись исполнителя (`У-153`); печать у КП не ставится. */
  branding: DocumentBranding;
  /** Кто отправляет — имя, почта сотрудника и телефон компании (`У-163`). */
  manager: { name: string; email: string | null; phone: string | null };
  /** Пометка предпросмотра (`У-147`). */
  draftNote: string | null;
};

const e = React.createElement;

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 9, padding: 44, color: '#111', lineHeight: 1.4 },
  title: { fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { fontSize: 9, textAlign: 'center', color: '#555', marginTop: 2, marginBottom: 14 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  addressee: { marginBottom: 10, fontSize: 9 },
  addresseeName: { fontWeight: 'bold' },
  paragraph: { marginBottom: 6 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    padding: 4,
    marginTop: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  colN: { width: '5%' },
  colName: { width: '39%' },
  colQuantity: { width: '10%', textAlign: 'right' },
  colUnit: { width: '8%', textAlign: 'center' },
  colPrice: { width: '19%', textAlign: 'right' },
  colAmount: { width: '19%', textAlign: 'right' },
  totals: { marginTop: 8, alignItems: 'flex-end' },
  totalLine: { fontSize: 9 },
  totalStrong: { fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  validUntil: {
    marginTop: 12,
    padding: 6,
    backgroundColor: '#FFF7ED',
    color: '#9A3412',
    fontWeight: 'bold',
  },
  logo: { height: 36, marginBottom: 8 },
  draftNote: { fontSize: 9, fontWeight: 'bold', color: '#EA580C', marginBottom: 8 },
  signBlock: { marginTop: 22 },
  signImage: { height: 42, marginBottom: 2 },
  signName: { fontSize: 9, fontWeight: 'bold' },
  signContact: { fontSize: 8, color: '#444' },
});

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('ru-RU');
}

/**
 * Абзацы КП печатаются ПО КЛЮЧУ, а не по номеру пункта, как в договоре.
 * Номеров у предложения нет, и фильтр по префиксу номера («1.», «2.») здесь
 * не нашёл бы ничего — молча, оставив письмо без единого слова текста.
 */
function clauseByKey(clauses: ResolvedClause[], key: string) {
  const found = clauses.find((c) => c.key === key);
  if (!found) return null;
  return e(Text, { style: styles.paragraph }, found.text);
}

function ProposalPdf({ data }: { data: ProposalDocumentData }) {
  const c = data.company;
  const m = data.manager;
  const contacts = [m.email, m.phone].filter(Boolean).join(' · ');

  return e(
    Document,
    {},
    e(
      Page,
      { size: 'A4', style: styles.page },
      data.branding.logo ? e(Image, { src: data.branding.logo, style: styles.logo }) : null,
      data.draftNote ? e(Text, { style: styles.draftNote }, data.draftNote) : null,
      e(Text, { style: styles.title }, `Коммерческое предложение № ${data.number}`),
      e(Text, { style: styles.subtitle }, 'на оказание услуг в области охраны труда'),
      e(
        View,
        { style: styles.metaRow },
        e(Text, {}, c.legalAddress ? c.legalAddress.split(',')[0] : 'г. Москва'),
        e(Text, {}, `от ${fmtDate(data.date)}`)
      ),
      e(
        View,
        { style: styles.addressee },
        e(Text, { style: styles.addresseeName }, data.addressee.name),
        data.addressee.contactName ? e(Text, {}, data.addressee.contactName) : null
      ),

      clauseByKey(data.clauses, 'proposal.intro'),

      e(
        View,
        { style: styles.tableHeader },
        e(Text, { style: styles.colN }, '№'),
        e(Text, { style: styles.colName }, 'Наименование услуги'),
        e(Text, { style: styles.colQuantity }, 'Кол-во'),
        e(Text, { style: styles.colUnit }, 'Ед.'),
        e(Text, { style: styles.colPrice }, 'Цена, ₽'),
        e(Text, { style: styles.colAmount }, 'Сумма, ₽')
      ),
      ...data.table.rows.map((row) =>
        e(
          View,
          { key: String(row.index), style: styles.tableRow },
          e(Text, { style: styles.colN }, String(row.index)),
          e(Text, { style: styles.colName }, row.name),
          e(Text, { style: styles.colQuantity }, row.quantity),
          e(Text, { style: styles.colUnit }, row.unit),
          e(Text, { style: styles.colPrice }, row.unitPrice),
          e(Text, { style: styles.colAmount }, row.amount)
        )
      ),
      e(
        View,
        { style: styles.totals },
        e(Text, { style: styles.totalLine }, data.table.subtotalLine),
        e(Text, { style: styles.totalLine }, data.table.vatLine),
        e(
          Text,
          { style: styles.totalStrong },
          `Итого: ${formatMoney(data.table.gross)} ₽ (${data.table.totalInWords})`
        )
      ),

      // Срок печатается отдельной строкой ПОМИМО текста «Условий»: менеджер
      // может переписать условия своими словами и убрать оттуда дату, а
      // предложение без срока — это прайс-лист, а не предложение.
      //
      // Формулировка нарочно не совпадает с текстом слота: это ПОДПИСЬ К
      // ЗНАЧЕНИЮ, как «Итого» у суммы, а не редактируемое предложение. Если
      // писать здесь ту же фразу, страж чистоты вёрстки не смог бы отличить
      // подпись от вернувшегося в код готового текста.
      data.validUntil
        ? e(Text, { style: styles.validUntil }, `Срок действия: до ${fmtDate(data.validUntil)}`)
        : null,

      clauseByKey(data.clauses, 'proposal.terms'),

      e(
        View,
        { style: styles.signBlock },
        data.branding.signature
          ? e(Image, { src: data.branding.signature, style: styles.signImage })
          : null,
        e(Text, { style: styles.signName }, m.name),
        contacts ? e(Text, { style: styles.signContact }, contacts) : null,
        e(Text, { style: styles.signContact }, c.displayName)
      )
    )
  );
}

export async function renderProposalDocumentPdf(data: ProposalDocumentData): Promise<Buffer> {
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(e(ProposalPdf, { data }) as any);
}
