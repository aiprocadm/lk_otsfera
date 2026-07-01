/**
 * §14 ТЗ: лимиты контактных лиц / пользователей. Форсируются серверно в
 * chokepoint-ах приглашения (organization/team.ts, partner/team.ts,
 * admin/users/mutations.ts). Считаются только АКТИВНЫЕ участники —
 * деактивированные не занимают слот.
 */
export const MAX_ORGANIZATION_USERS = 10;
export const MAX_PARTNER_USERS = 5;
