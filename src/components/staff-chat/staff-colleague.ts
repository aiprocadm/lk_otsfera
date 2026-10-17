/**
 * Коллега в чате команды и подпись его роли (`У-315`): общий кусочек списка
 * бесед и формы нового чата — отдельным файлом, чтобы они не ссылались друг
 * на друга по кругу.
 */
export type StaffColleagueVM = { id: string; name: string; role?: string | undefined };

const STAFF_ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  leader: 'Руководитель',
  manager: 'Менеджер',
};

/** Подпись роли коллеги; незнакомая роль — как есть. */
export function staffRoleLabel(role: string): string {
  return STAFF_ROLE_LABEL[role] ?? role;
}
