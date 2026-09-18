/**
 * Имя файла при скачивании документа (`У-154`, этап 6; дефект `Д-17`).
 *
 * Ссылка на файл в хранилище подписывается по ключу вида
 * `orders/<id>/generated/invoice-v1-<uuid>.pdf`, и без явного имени браузер
 * сохраняет файл ровно так. У клиента в папке «Загрузки» оказывалась россыпь
 * одинаковых `invoice-v1-…pdf` — понять, какой из них какой счёт, нельзя.
 *
 * Правило простое: у выпущенного документа имя собирается по-человечески —
 * «Счёт С-2026-7 от 26.07.2026.pdf». У загруженного вручную номера нет, и
 * тогда остаётся имя, под которым файл загрузили: подменять его выдумкой
 * хуже, чем оставить как есть.
 */

/** Русские названия типов — те же слова, что в интерфейсе (глоссарий). */
const TYPE_LABELS: Record<string, string> = {
  invoice: 'Счёт',
  act: 'Акт',
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
  commercial_proposal: 'Коммерческое предложение',
  waybill: 'Накладная',
  certificate: 'Удостоверение',
  other: 'Документ',
};

/** Символы, недопустимые в имени файла на Windows и macOS. */
const FORBIDDEN = /[\\/:*?"<>|]/g;

/**
 * Русское название типа документа — одно слово на все выгрузки и экраны, где
 * тип показывают человеку (`У-173`: лист «Документы» пакета для 1С).
 */
export function documentTypeLabelRu(type: string): string {
  return TYPE_LABELS[type] ?? TYPE_LABELS.other!;
}

/**
 * Имя файла внутри архива — без повторов: «… (2).pdf», если такое уже есть.
 *
 * Правило одно на оба архива — пакет для 1С (`У-173`) и «Скачать выбранные»
 * (`У-252`): два одинаковых имени в одном ZIP — это либо потерянный файл, либо
 * непонятно чей. Расширение у имени есть всегда: `documentDownloadName` его
 * гарантирует.
 */
export function uniqueArchiveName(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf('.');
  let name = base;
  for (let i = 2; used.has(name); i += 1) {
    name = `${base.slice(0, dot)} (${i})${base.slice(dot)}`;
  }
  used.add(name);
  return name;
}

export function documentDownloadName(doc: {
  type: string;
  number: string | null;
  createdAt: Date;
  name: string;
}): string {
  if (!doc.number) return doc.name;

  const label = documentTypeLabelRu(doc.type);
  const date = new Date(doc.createdAt).toLocaleDateString('ru-RU');
  // Расширение берём у исходного имени: сгенерированные документы — PDF, но
  // тип файла задаёт не тип документа, а сам файл.
  const dot = doc.name.lastIndexOf('.');
  const ext = dot > 0 ? doc.name.slice(dot) : '.pdf';
  return `${label} ${doc.number} от ${date}${ext}`.replace(FORBIDDEN, '_');
}
