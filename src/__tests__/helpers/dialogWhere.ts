import type { Prisma } from '@prisma/client';

/**
 * Крошечный «Postgres» для where-формы диалогов (`У-214`).
 *
 * Зачем он нужен. Правило «кто какие диалоги видит» написано в ДВУХ видах:
 * условие для выборки (`dialogWhereForLevel`) и проверка уже загруженной
 * строки (`canSeeDialog`). Сравнивать их можно только через ПОВЕДЕНИЕ: если
 * тест сверяет условие с эталонным объектом (`toEqual({ AND: [...] })`), то он
 * проверяет форму записи, а не смысл — и переписанное на эквивалентную форму
 * условие уронит тест, а молча расширенное (например, без `assigneeId`) может
 * и не уронить, если эталон правили «под код».
 *
 * Поэтому помощник берёт условие как есть и отвечает на вопрос, который
 * задаст база: «попадёт ли эта строка в выборку?». Тогда обе формы можно
 * прогнать по одному набору диалогов и потребовать одинаковых ответов.
 *
 * Понимает ровно то, что используют фильтры диалогов: `OR`, `AND`, сравнение
 * трёх полей и `{ in: [...] }`. Незнакомое условие — исключение, а не «false»:
 * тихо промолчать здесь значило бы проверять не тот фильтр, который написан.
 */

/** Диалог в том объёме, который читают правила охвата. */
export type DialogRow = {
  companyId: string | null;
  assigneeId: string | null;
  organizationId: string | null;
};

const FIELDS = ['companyId', 'assigneeId', 'organizationId'] as const;
type Field = (typeof FIELDS)[number];

function fieldMatches(expected: unknown, actual: string | null): boolean {
  if (expected !== null && typeof expected === 'object') {
    const list = (expected as { in?: unknown }).in;
    if (!Array.isArray(list)) {
      throw new Error(`условие ${JSON.stringify(expected)} помощник читать не умеет`);
    }
    // `{ in: [...] }` в Postgres по NULL не совпадает никогда — то же и здесь.
    return actual !== null && (list as unknown[]).includes(actual);
  }
  return expected === actual;
}

export function dialogMatchesWhere(
  where: Prisma.MessengerDialogWhereInput,
  dialog: DialogRow
): boolean {
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => {
    if (key === 'OR') {
      return (value as Prisma.MessengerDialogWhereInput[]).some((w) =>
        dialogMatchesWhere(w, dialog)
      );
    }
    if (key === 'AND') {
      return (value as Prisma.MessengerDialogWhereInput[]).every((w) =>
        dialogMatchesWhere(w, dialog)
      );
    }
    if ((FIELDS as readonly string[]).includes(key)) {
      return fieldMatches(value, dialog[key as Field]);
    }
    throw new Error(
      `в фильтре диалогов появилось условие «${key}» — обновите помощник вместе с фильтром`
    );
  });
}
