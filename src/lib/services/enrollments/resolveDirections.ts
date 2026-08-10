import type { PrismaClient } from '@prisma/client';

/**
 * Сверка названий направлений из файла со справочником (`У-41`, этап 6).
 *
 * Парсер Excel остаётся чистым и отдаёт **названия**; в идентификаторы их
 * превращает этот сервис — он единственный, у кого есть справочник.
 *
 * Нераспознанное название — **ошибка строки с подсказкой**, а не тихий
 * пропуск: человек должен видеть, что именно написать (§15 «ошибка с выходом»).
 * Сравнение нечувствительно к регистру и к «ё/е» — как в разборе файлов 1С.
 */
export function normalizeDirectionName(raw: string): string {
  return raw.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export type ResolvedDirections = {
  /** Идентификаторы по индексу входного массива; null — название не указано. */
  ids: (string | null)[];
  /** Ошибки строк: «Строка N: направление … не найдено. Допустимые: …». */
  errors: string[];
};

export async function resolveDirectionNames(
  prisma: PrismaClient,
  names: (string | null)[],
  label: (index: number) => string = (i) => `Строка ${i + 2}`
): Promise<ResolvedDirections> {
  const directions = await prisma.trainingDirection.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  const byName = new Map(directions.map((d) => [normalizeDirectionName(d.name), d.id]));
  const allowed = directions.map((d) => d.name).join(', ');

  const ids: (string | null)[] = [];
  const errors: string[] = [];

  names.forEach((raw, i) => {
    if (!raw) {
      ids.push(null);
      return;
    }
    const id = byName.get(normalizeDirectionName(raw));
    if (!id) {
      ids.push(null);
      errors.push(
        `${label(i)}: направление «${raw}» не найдено в справочнике.` +
          (allowed ? ` Допустимые значения: ${allowed}.` : ' Справочник направлений пуст.')
      );
      return;
    }
    ids.push(id);
  });

  return { ids, errors };
}
