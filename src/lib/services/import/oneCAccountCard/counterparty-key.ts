/**
 * Ключ контрагента (`У-83`) — нормализованное наименование для дедупликации
 * и точного сопоставления: верхний регистр, `ё → е`, кавычки и пунктуация →
 * пробел, пробелы схлопнуты, организационно-правовая форма вынесена в
 * отдельное поле. Единый алгоритм для матчера, автосоздания и очереди;
 * SQL-бэкфилл миграции `stage1_counterparty_key` повторяет его дословно —
 * паритет держит тест `import.card51.counterparty-key.sql-parity`.
 *
 * Форма ищется токеном `(^|\s)ФОРМА(?=\s|$)` — НЕ `\b`: граница слова в JS
 * не срабатывает на кириллице, из-за чего прежняя normalizeName не срезала
 * форму без пунктуации вокруг («ХОЛДИНГ ГЕФЕСТ ООО»).
 */

const PUNCTUATION_RE = /[«»"'`().,;:!?/\\-]/g;

const ORG_FORM_ALTERNATION = 'ООО|АО|ПАО|ЗАО|ОАО|ИП|НКО|АНО|ГБУ|МБУ|ФГУП|МУП';

export function counterpartyKey(raw: string): { key: string; orgForm: string | null } {
  const cleaned = raw
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(PUNCTUATION_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const formMatch = cleaned.match(new RegExp(`(^|\\s)(${ORG_FORM_ALTERNATION})(?=\\s|$)`));
  const key = cleaned
    .replace(new RegExp(`(^|\\s)(${ORG_FORM_ALTERNATION})(?=\\s|$)`, 'g'), '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { key, orgForm: formMatch?.[2] ?? null };
}

/**
 * Ключ для `Organization.nameKey` (`У-84`): пустой ключ хранится как NULL —
 * ветка «имя состоит из одной орг-формы» живёт здесь, а не в каждом писателе.
 */
export function organizationNameKey(name: string): string | null {
  return counterpartyKey(name).key || null;
}
