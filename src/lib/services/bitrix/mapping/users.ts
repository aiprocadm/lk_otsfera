import type { BitrixUserLike, UserMapRow } from './types';

/**
 * Пользователи портала → сотрудники ЛК (`У-192`). Новых пользователей миграция
 * не создаёт: сопоставление идёт по почте среди сотрудников компании-исполнителя,
 * затем по сохранённой таблице (её правит администратор в предпросмотре), а
 * несопоставленным достаётся менеджер по умолчанию.
 *
 * Порядок важен: почта — факт, таблица — решение человека, поэтому таблица
 * СИЛЬНЕЕ почты (администратор мог развести двух однофамильцев вручную).
 */
export type CompanyUser = { id: string; email: string; name: string };

export type UserMapping = {
  rows: UserMapRow[];
  /** Пользователь ЛК для ответственного из Битрикса; `null` — не нашли. */
  resolve: (bitrixUserId: string | null) => string | null;
};

export function mapUsers(
  bitrixUsers: readonly BitrixUserLike[],
  companyUsers: readonly CompanyUser[],
  userMap: Record<string, string>
): UserMapping {
  const byEmail = new Map<string, CompanyUser>();
  for (const u of companyUsers) {
    const email = u.email.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, u);
  }
  const known = new Set(companyUsers.map((u) => u.id));

  const rows: UserMapRow[] = [];
  const resolved = new Map<string, string>();
  for (const user of bitrixUsers) {
    const fromTable = userMap[user.id];
    // Сохранённая таблица может указывать на уволенного: такую строку не берём,
    // иначе задачи и заказы уедут на пользователя, которого уже нет в компании.
    if (fromTable && known.has(fromTable)) {
      rows.push({
        bitrixId: user.id,
        name: user.name,
        email: user.email,
        userId: fromTable,
        matchedBy: 'table',
      });
      resolved.set(user.id, fromTable);
      continue;
    }
    const email = user.email?.trim().toLowerCase() ?? '';
    const match = email ? byEmail.get(email) : undefined;
    rows.push({
      bitrixId: user.id,
      name: user.name,
      email: user.email,
      userId: match?.id ?? null,
      matchedBy: match ? 'email' : 'none',
    });
    if (match) resolved.set(user.id, match.id);
  }

  return {
    rows,
    resolve: (bitrixUserId) => (bitrixUserId ? (resolved.get(bitrixUserId) ?? null) : null),
  };
}

/**
 * Ответственный строки: сопоставленный пользователь, иначе менеджер по
 * умолчанию. `null` означает «назначить некому» — сущности, где ответственный
 * обязателен (лид, задача), становятся конфликтом, а не создаются безхозными.
 */
export function assigneeFor(
  bitrixUserId: string | null,
  ctx: { defaultManagerId: string | null; resolveUser: (id: string | null) => string | null }
): string | null {
  return ctx.resolveUser(bitrixUserId) ?? ctx.defaultManagerId;
}
