/**
 * Три правила повторного применения пакета (`У-195`, спека §3.4).
 *
 * Перенос запускают не один раз: сначала пробный, потом боевой, потом
 * еженедельный, пока Битрикс ещё жив. Значит, второй прогон обязан быть
 * безопасным — иначе он затрёт работу менеджеров, сделанную между прогонами.
 *
 * 1. **Пустое не затирает.** Поле, которого в Битриксе нет, не пишется: там
 *    его могли просто не заполнить, а в кабинете оно уже есть.
 * 2. **Правленное руками не перезаписывается.** Значение в кабинете
 *    сравнивается с тем, что записал прошлый прогон (`after` из журнала).
 *    Разошлось — человек правил руками, и его правка сильнее Битрикса.
 * 3. **Снимок `before` — только по изменённым полям.** Откат должен вернуть
 *    ровно то, что тронули, а не всю строку целиком.
 */
export type FieldValue = string | number | boolean | Date | null;
export type FieldMap = Record<string, FieldValue>;

export type MergeResult = {
  /** Что писать в базу; пусто — писать нечего. */
  data: FieldMap;
  /** Как было до записи (для отката). */
  before: FieldMap;
  /** Как стало (ляжет в журнал и станет опорой для следующего прогона). */
  after: FieldMap;
  /** Поля, которые оставили человеку — попадут в отчёт строкой «оставлено ручное». */
  keptManual: string[];
};

/** Пустое из Битрикса: ни `null`, ни пустая строка полем не считаются. */
function isEmpty(value: FieldValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Сравнение значений разных видов. Даты приходят объектами, суммы — строками
 * из `Decimal`, поэтому сравнивать надо по нормализованному виду, а не по
 * ссылке: иначе одна и та же дата каждый раз выглядела бы «изменившейся».
 */
export function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : null;
    const bt = b instanceof Date ? b.getTime() : null;
    return at === bt;
  }
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // Сумма «120000» из базы и 120000 из Битрикса — одно и то же число.
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return a === b;
}

export function mergeUpdate(
  current: FieldMap,
  incoming: Partial<FieldMap>,
  lastAfter: FieldMap | null
): MergeResult {
  const result: MergeResult = { data: {}, before: {}, after: {}, keptManual: [] };

  for (const [field, value] of Object.entries(incoming)) {
    if (isEmpty(value)) continue;

    const currentValue = current[field] ?? null;
    if (sameValue(currentValue, value)) continue;

    // Прошлый прогон записал одно, а сейчас в кабинете другое — значит, поле
    // правил человек. Его работа важнее повторного переноса истории.
    if (lastAfter && field in lastAfter && !sameValue(currentValue, lastAfter[field])) {
      result.keptManual.push(field);
      continue;
    }

    result.data[field] = value as FieldValue;
    result.before[field] = currentValue;
    result.after[field] = value as FieldValue;
  }

  return result;
}

/** Есть ли что писать: пустой патч — повод не трогать строку и не плодить журнал. */
export function hasChanges(merge: MergeResult): boolean {
  return Object.keys(merge.data).length > 0;
}
