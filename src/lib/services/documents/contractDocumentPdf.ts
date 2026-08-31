import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import React from 'react';
import { registerPdfFonts, PDF_FONT_FAMILY } from '@/lib/pdf/fonts';
import type { ResolvedClause } from '@/lib/documents/contractTemplate';
import type { PartyBlock } from './orderDocumentPdf';
import { formatMoney, type PrintTable } from './printTable';
import type { DocumentBranding } from './branding';

/**
 * Этап 8 (ФТ-9.3/9.4, PR-3) — встроенные шаблоны договора и доп. соглашения.
 * Оперативные документы платформы (решение §10-3 ТЗ): типовой текст с
 * автоподстановкой реквизитов сторон, предмета и суммы заказа. Отдельный
 * файл от счёта/акта — у договора принципиально иной лейаут (нумерованные
 * разделы, блоки реквизитов внизу).
 */

export type ContractDocumentData = {
  docType: 'contract' | 'extra_agreement';
  number: string; // «Д-2026-4» / «ДС-2026-4»
  date: Date;
  company: PartyBlock;
  organization: PartyBlock;
  /**
   * Готовые абзацы документа (`У-160`): текст уже выбран между разовой
   * правкой из формы, текстом компании и встроенной формулировкой, и
   * подстановки в нём уже раскрыты. Вёрстка юридических текстов не знает —
   * она печатает то, что ей дали, и добавляет только номер пункта.
   */
  clauses: ResolvedClause[];
  /** Состав услуг и итоги (`У-141`) — тот же расчёт, что в счёте и акте. */
  table: PrintTable;
  /** Логотип, подпись и печать исполнителя (`У-153`). */
  branding: DocumentBranding;
  /** Для доп. соглашения — номер и дата исходного договора. */
  baseContract: { number: string; date: Date } | null;
  /**
   * Пометка предпросмотра (`У-147`): человек должен с одного взгляда видеть,
   * что перед ним ещё не выпущенный документ, иначе такой PDF уедет клиенту.
   */
  draftNote: string | null;
};

const e = React.createElement;

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 9, padding: 44, color: '#111', lineHeight: 1.4 },
  title: { fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { fontSize: 9, textAlign: 'center', color: '#555', marginTop: 2, marginBottom: 14 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  preamble: { marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 10, marginBottom: 3 },
  paragraph: { marginBottom: 3 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    padding: 4,
    marginTop: 6,
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
  logo: { height: 36, marginBottom: 8 },
  draftNote: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#EA580C',
    marginBottom: 8,
  },

  signMarks: { flexDirection: 'row', alignItems: 'flex-end', height: 50, marginTop: 6 },
  signImage: { height: 42 },
  stampImage: { height: 50, marginLeft: 8 },
  requisites: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  reqBlock: { width: '48%' },
  reqTitle: { fontSize: 9, fontWeight: 'bold', marginBottom: 3 },
  reqLine: { fontSize: 8, color: '#333' },
  signLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#111',
    marginTop: 24,
    paddingTop: 3,
    fontSize: 8,
    color: '#444',
  },
});

function requisiteLines(p: PartyBlock): string[] {
  const lines: string[] = [p.displayName];
  if (p.inn) lines.push(`ИНН ${p.inn}${p.kpp ? `, КПП ${p.kpp}` : ''}`);
  if (p.legalAddress) lines.push(`Адрес: ${p.legalAddress}`);
  if (p.bankName) lines.push(`Банк: ${p.bankName}`);
  if (p.bankAccount) lines.push(`Р/с ${p.bankAccount}`);
  if (p.corrAccount) lines.push(`К/с ${p.corrAccount}`);
  if (p.bic) lines.push(`БИК ${p.bic}`);
  if (p.phone) lines.push(`Тел.: ${p.phone}`);
  if (p.email) lines.push(p.email);
  return lines;
}

function signerPhrase(p: PartyBlock): string {
  if (!p.signerName) return p.displayName;
  const role = p.signerPosition ? `${p.signerPosition} ` : '';
  return `${role}${p.signerName}`;
}

/**
 * Подпись и печать исполнителя над линией подписи (`У-153`). Нет файлов —
 * возвращаем `null`, и договор печатается как прежде.
 */
function signatureMarks(branding: DocumentBranding) {
  if (!branding.signature && !branding.stamp) return null;
  return e(
    View,
    { style: styles.signMarks },
    branding.signature ? e(Image, { src: branding.signature, style: styles.signImage }) : null,
    branding.stamp ? e(Image, { src: branding.stamp, style: styles.stampImage }) : null
  );
}

/**
 * Абзац с номером пункта. Номер печатает вёрстка, а не текст: пока «2.2.»
 * жило внутри строки, сотрудник, заменивший порядок оплаты своей
 * формулировкой, ронял номер — соседние пункты оставались пронумерованными,
 * а его нет.
 */
function clauseParagraphs(clauses: ResolvedClause[], section: string) {
  return (
    clauses
      // Абзацы разложены по разделам НОМЕРОМ пункта, а не списком ключей:
      // список пришлось бы дописывать вручную при каждом новом абзаце, и
      // забытый ключ означал бы пункт, который молча не печатается.
      .filter((c) => c.clause.startsWith(`${section}.`))
      .map((c) => e(Text, { key: c.key, style: styles.paragraph }, `${c.clause}. ${c.text}`))
  );
}

function ContractPdf({ data }: { data: ContractDocumentData }) {
  const dateStr = new Date(data.date).toLocaleDateString('ru-RU');
  const isExtra = data.docType === 'extra_agreement';
  const c = data.company;
  const o = data.organization;

  const preamble = isExtra
    ? `${c.displayName}, именуемое в дальнейшем «Исполнитель», в лице ${signerPhrase(c)}, с одной стороны, и ${o.displayName}, именуемое в дальнейшем «Заказчик», в лице ${signerPhrase(o)}, с другой стороны, заключили настоящее дополнительное соглашение к договору № ${data.baseContract?.number ?? '—'} от ${data.baseContract ? new Date(data.baseContract.date).toLocaleDateString('ru-RU') : '—'} о нижеследующем.`
    : `${c.displayName}, именуемое в дальнейшем «Исполнитель», в лице ${signerPhrase(c)}, действующего на основании ${c.signerBasis ?? 'устава'}, с одной стороны, и ${o.displayName}, именуемое в дальнейшем «Заказчик», в лице ${signerPhrase(o)}, действующего на основании ${o.signerBasis ?? 'устава'}, с другой стороны, заключили настоящий договор о нижеследующем.`;

  return e(
    Document,
    {},
    e(
      Page,
      { size: 'A4', style: styles.page },
      data.branding.logo ? e(Image, { src: data.branding.logo, style: styles.logo }) : null,
      data.draftNote ? e(Text, { style: styles.draftNote }, data.draftNote) : null,
      e(
        Text,
        { style: styles.title },
        `${isExtra ? 'Дополнительное соглашение' : 'Договор'} № ${data.number}`
      ),
      e(
        Text,
        { style: styles.subtitle },
        isExtra
          ? 'на оказание услуг (изменение условий)'
          : 'на оказание услуг в области охраны труда'
      ),
      e(
        View,
        { style: styles.metaRow },
        e(Text, {}, c.legalAddress ? c.legalAddress.split(',')[0] : 'г. Москва'),
        e(Text, {}, dateStr)
      ),
      e(Text, { style: styles.preamble }, preamble),

      e(Text, { style: styles.sectionTitle }, '1. Предмет'),
      ...clauseParagraphs(data.clauses, '1'),
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

      e(Text, { style: styles.sectionTitle }, '2. Цена и порядок расчётов'),
      e(
        Text,
        { style: styles.paragraph },
        `2.1. Общая стоимость услуг составляет ${formatMoney(data.table.gross)} ₽ (${data.table.totalInWords}). ${data.table.vatLine}.`
      ),
      ...clauseParagraphs(data.clauses, '2'),

      e(Text, { style: styles.sectionTitle }, '3. Сроки и порядок сдачи-приёмки'),
      ...clauseParagraphs(data.clauses, '3'),

      e(Text, { style: styles.sectionTitle }, '4. Ответственность и прочие условия'),
      ...clauseParagraphs(data.clauses, '4'),

      e(Text, { style: styles.sectionTitle }, '5. Реквизиты и подписи Сторон'),
      e(
        View,
        { style: styles.requisites },
        e(
          View,
          { style: styles.reqBlock },
          e(Text, { style: styles.reqTitle }, 'Исполнитель'),
          ...requisiteLines(c).map((l, i) => e(Text, { key: String(i), style: styles.reqLine }, l)),
          signatureMarks(data.branding),
          e(Text, { style: styles.signLine }, signerPhrase(c))
        ),
        e(
          View,
          { style: styles.reqBlock },
          e(Text, { style: styles.reqTitle }, 'Заказчик'),
          ...requisiteLines(o).map((l, i) => e(Text, { key: String(i), style: styles.reqLine }, l)),
          e(Text, { style: styles.signLine }, signerPhrase(o))
        )
      )
    )
  );
}

export async function renderContractDocumentPdf(data: ContractDocumentData): Promise<Buffer> {
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(e(ContractPdf, { data }) as any);
}
