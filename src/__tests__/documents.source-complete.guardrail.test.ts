import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_SOURCES,
  DOCUMENT_SOURCE_LABELS,
  documentSource,
  documentSourceWhere,
  isDocumentSource,
  type DocumentSource,
  type DocumentSourceFields,
} from '@/lib/documents/source';

/**
 * СТРАЖ `У-258`: колонка «источник» и фильтр «источник» показывают одно и то же.
 *
 * Признак («откуда этот документ») и условие выборки («покажи документы
 * оттуда») — две половины одного правила, и живут они в одном файле именно
 * потому, что разъезжаются молча: строка в списке подписана «Из 1С», а фильтр
 * «Из 1С» её не находит. Ни ошибки, ни падения — человек просто решает, что
 * документа нет.
 *
 * Поэтому страж не проверяет «функция существует». Он берёт по представителю
 * каждого источника и требует, чтобы **ровно одно** условие выборки совпало с
 * документом и чтобы это было условие того же источника, который назвал
 * признак. Условие интерпретируется здесь маленьким толкователем: гонять
 * Prisma ради шести объектов незачем, а согласованность видна и так.
 *
 * Мутация (проверено, четыре поломки): переставить `bitrixId` и `externalId` в
 * `documentSource`; убрать `generatedBy: 'user'` из условия «загружен
 * клиентом»; выкинуть роль `leader` из ведра «сотрудник»; назвать два
 * источника одинаково — все четыре краснеют.
 *
 * **Первая редакция стража была слепа к двум из них.** Она проверяла шесть
 * «чистых» представителей, у которых признаки не пересекаются, — а ломается
 * правило ровно на пересечениях. Поэтому ниже есть отдельный список
 * пограничных документов, и именно он ловит порядок проверок.
 */

/** Документ-представитель для каждого источника. */
const FIXTURES: Record<DocumentSource, DocumentSourceFields> = {
  bitrix: { bitrixId: 'b1', externalId: null, generatedBy: 'user', uploadedBy: null },
  one_c: { bitrixId: null, externalId: 'e1', generatedBy: 'system', uploadedBy: null },
  generated: { bitrixId: null, externalId: null, generatedBy: 'system', uploadedBy: null },
  client: {
    bitrixId: null,
    externalId: null,
    generatedBy: 'user',
    uploadedBy: { role: 'organization' },
  },
  partner: {
    bitrixId: null,
    externalId: null,
    generatedBy: 'user',
    uploadedBy: { role: 'partner' },
  },
  staff: { bitrixId: null, externalId: null, generatedBy: 'user', uploadedBy: { role: 'leader' } },
  unknown: { bitrixId: null, externalId: null, generatedBy: 'user', uploadedBy: null },
};

/**
 * Пограничные документы — те, на которых правило и ломается.
 *
 * Шесть «чистых» представителей выше проверяют, что источник достижим, но
 * НЕ проверяют порядок: у них признаки не пересекаются. А в жизни пересекаются
 * постоянно: файл приехал из Битрикса и потом уехал в 1С, выпущенный в
 * кабинете документ имеет и автора, и внешний идентификатор. Первая редакция
 * этого стража пропускала и перестановку «Битрикс ↔ 1С», и потерю условия
 * «создан загрузкой» — обе мутации проходили зелёными.
 */
const TRICKY: Array<{ name: string; doc: DocumentSourceFields; expected: DocumentSource }> = [
  {
    name: 'приехал из Битрикса и потом уехал в 1С',
    doc: { bitrixId: 'b1', externalId: 'e1', generatedBy: 'user', uploadedBy: null },
    expected: 'bitrix',
  },
  {
    name: 'выпущен в кабинете и выгружен в 1С',
    doc: { bitrixId: null, externalId: 'e2', generatedBy: 'system', uploadedBy: null },
    expected: 'one_c',
  },
  {
    name: 'выпущен в кабинете, автор — сотрудник клиента',
    doc: {
      bitrixId: null,
      externalId: null,
      generatedBy: 'system',
      uploadedBy: { role: 'organization' },
    },
    expected: 'generated',
  },
  {
    name: 'выпущен в кабинете, автор — сотрудник исполнителя',
    doc: {
      bitrixId: null,
      externalId: null,
      generatedBy: 'system',
      uploadedBy: { role: 'manager' },
    },
    expected: 'generated',
  },
  {
    name: 'загрузчик с ролью вне списка известных',
    doc: { bitrixId: null, externalId: null, generatedBy: 'user', uploadedBy: { role: 'student' } },
    expected: 'unknown',
  },
];

type WhereLike = Record<string, unknown>;

/** Совпадает ли одно поле условия с документом. */
function fieldMatches(value: unknown, actual: string | null): boolean {
  if (value === null) return actual === null;
  if (typeof value === 'string') return actual === value;
  if (value && typeof value === 'object') {
    const cond = value as { not?: unknown; in?: string[]; notIn?: string[] };
    if ('not' in cond) return cond.not === null ? actual !== null : actual !== cond.not;
    if (cond.in) return actual !== null && cond.in.includes(actual);
    if (cond.notIn) return actual !== null && !cond.notIn.includes(actual);
  }
  return false;
}

/**
 * Толкователь условия выборки: понимает ровно те формы, которые встречаются в
 * `documentSourceWhere`. Незнакомая форма — это не «совпало», а повод упасть:
 * молчаливое «не совпало» превратило бы стража в зелёную заглушку.
 */
function whereMatches(where: WhereLike, doc: DocumentSourceFields): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      const branches = value as WhereLike[];
      if (!branches.some((b) => whereMatches(b, doc))) return false;
      continue;
    }
    if (key === 'bitrixId') {
      if (!fieldMatches(value, doc.bitrixId)) return false;
      continue;
    }
    if (key === 'externalId') {
      if (!fieldMatches(value, doc.externalId)) return false;
      continue;
    }
    if (key === 'generatedBy') {
      if (!fieldMatches(value, doc.generatedBy)) return false;
      continue;
    }
    if (key === 'uploadedById') {
      // В условии встречается только `uploadedById: null` — «загрузчика нет».
      if (value !== null) throw new Error(`неизвестная форма uploadedById: ${String(value)}`);
      if (doc.uploadedBy !== null) return false;
      continue;
    }
    if (key === 'uploadedBy') {
      const role = (value as { role?: unknown }).role;
      if (doc.uploadedBy === null) return false;
      if (!fieldMatches(role, doc.uploadedBy.role)) return false;
      continue;
    }
    throw new Error(`страж не понимает поле условия «${key}» — допишите толкователь`);
  }
  return true;
}

describe('страж: источник документа — признак и фильтр совпадают (У-258)', () => {
  it('у каждого источника есть русское название', () => {
    for (const source of DOCUMENT_SOURCES) {
      const label = DOCUMENT_SOURCE_LABELS[source];
      expect(label, `источник «${source}» остался без русского названия`).toBeTruthy();
      expect(label.length, `название источника «${source}» слишком короткое`).toBeGreaterThan(2);
    }
    // Названия не повторяются: два одинаковых пункта в фильтре человек примет
    // за ошибку экрана.
    const labels = DOCUMENT_SOURCES.map((s) => DOCUMENT_SOURCE_LABELS[s]);
    expect(new Set(labels).size, 'два источника названы одинаково').toBe(labels.length);
  });

  it('признак называет каждый источник — ни один не стал недостижимым', () => {
    for (const source of DOCUMENT_SOURCES) {
      expect(
        documentSource(FIXTURES[source]),
        `представитель «${source}» больше не относится к этому источнику`
      ).toBe(source);
    }
  });

  it('признак и фильтр согласованы: условие совпадает ровно одно и то же самое', () => {
    const cases: Array<{ name: string; doc: DocumentSourceFields; expected: DocumentSource }> = [
      ...DOCUMENT_SOURCES.map((source) => ({
        name: `представитель «${source}»`,
        doc: FIXTURES[source],
        expected: source,
      })),
      ...TRICKY,
    ];

    for (const { name, doc, expected } of cases) {
      expect(documentSource(doc), `${name}: признак назвал другой источник`).toBe(expected);
      const matched = DOCUMENT_SOURCES.filter((candidate) =>
        whereMatches(documentSourceWhere(candidate) as WhereLike, doc)
      );
      expect(
        matched,
        `${name}: попадает под фильтры «${matched.join(', ') || 'ни один'}», а признак говорит «${expected}»`
      ).toEqual([expected]);
    }
  });

  it('чужое слово источником не считается', () => {
    expect(isDocumentSource('one_c')).toBe(true);
    expect(isDocumentSource('из 1с')).toBe(false);
    expect(isDocumentSource('')).toBe(false);
  });
});
