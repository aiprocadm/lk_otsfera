/**
 * `Р-27` (вопрос `В-3`): доски сортируют `status asc` и полагаются на порядок
 * enum — живые значения раньше терминальных. Общее для юнит-стража по
 * `schema.prisma` и integration-стража по `pg_enum`.
 */

/** Enum → его терминальные (закрытые) значения; всё остальное — живое. */
export const TERMINAL: Record<string, string[]> = {
  DealStatus: ['won', 'lost'],
  LeadStatus: ['promoted_to_order', 'promoted_to_deal', 'rejected'],
  TaskStatus: ['done'],
};

/** Значения enum из текста `schema.prisma` в порядке объявления. */
export function enumValues(schema: string, name: string): string[] {
  const m = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m) return [];
  return m[1]!
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !l.startsWith('@@'));
}

/** Живые значения строго раньше терминальных; возвращает нарушителей. */
export function liveAfterTerminal(values: string[], terminal: string[]): string[] {
  const firstTerminal = values.findIndex((v) => terminal.includes(v));
  if (firstTerminal < 0) return [];
  return values.slice(firstTerminal).filter((v) => !terminal.includes(v));
}
