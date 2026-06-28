/**
 * action-коды AuditLog → русская фраза для ленты «Последние события»
 * (admin-дашборд). Формат — глагольная фраза от лица актора:
 * «<Имя> утвердил отчёт по комиссии». Покрывает TRACKED_ACTIONS из
 * services/admin/dashboard.ts; новый код без перевода деградирует
 * в читаемый fallback (подчёркивания -> пробелы), не в cuid-кашу.
 */
const ACTION_RU: Record<string, string> = {
  commission_statement_calculated: 'рассчитал отчёт по комиссии',
  commission_statement_approved: 'утвердил отчёт по комиссии',
  commission_statement_paid: 'отметил отчёт по комиссии оплаченным',
  partner_commission_rate_changed: 'изменил ставку партнёра',
  lead_created: 'создал заявку',
  lead_withdrawn: 'отозвал заявку',
  partner_member_invited: 'пригласил сотрудника партнёра',
  partner_member_deactivated: 'деактивировал сотрудника партнёра',
  partner_member_scope_changed: 'изменил зону видимости сотрудника партнёра',
  partner_created: 'создал партнёра',
  partner_updated: 'обновил партнёра',
  partner_deactivated: 'деактивировал партнёра',
  user_role_changed: 'изменил роль пользователя',
  org_rate_override: 'назначил индивидуальную ставку организации',
  organization_rate_override: 'назначил индивидуальную ставку организации',
  lead_promoted: 'перевёл заявку в заказ',
  lead_promoted_to_order: 'перевёл заявку в заказ',
};

export function auditActionRu(action: string): string {
  return ACTION_RU[action] ?? action.replaceAll('_', ' ');
}
