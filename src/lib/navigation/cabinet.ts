import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

export type NavItem = {
  href: string;
  label: string;
  disabled?: boolean;
  flag?: FeatureFlag;
  leaderOnly?: boolean;
  partnerAdminOnly?: boolean;
  /** Иконка для org-sidebar и других сайдбаров (emoji). */
  icon?: string;
  /** Виден только org-admin и org-leader (фильтруется в OrgSidebar по viewerRole, НЕ в navItemsFor). */
  orgAdminOrLeaderOnly?: boolean;
  /** Секция админского сайдбара («Платформа» / «Операции» / «Справочники»). Прочие шеллы игнорируют. */
  group?: string;
  /** Скрыть пункт, когда флаг ВКЛЮЧЁН (обратный гейт: «Команда» менеджера уезжает в /leader). */
  hiddenWhenFlag?: FeatureFlag;
};

// 'leader' — НЕ новая JWT-роль (это manager + managerRole='leader'); ключ существует только в каноне меню.
export const navByRole: Record<Role | 'leader', NavItem[]> = {
  // /admin/orders намеренно НЕ в меню: это deprecated-redirect на дашборд (реальна только деталь /admin/orders/[id]).
  admin: [
    { href: '/admin/dashboard', label: 'Главная', icon: '⌂', group: 'Платформа' },
    { href: '/admin/health', label: 'Здоровье', icon: '💚', group: 'Платформа' },
    { href: '/admin/sync', label: 'Синхронизация', icon: '🔄', group: 'Платформа' },
    { href: '/admin/documents', label: 'Документы', icon: '📄', group: 'Операции' },
    { href: '/admin/messages', label: 'Сообщения', icon: '💬', group: 'Операции' },
    { href: '/admin/commission-statements', label: 'Комиссии', icon: '💰', group: 'Операции' },
    { href: '/admin/commission-corrections', label: 'Корректировки', icon: '🔁', group: 'Операции' },
    { href: '/admin/finance', label: 'Финансы', icon: '₽', group: 'Операции' },
    { href: '/admin/import', label: 'Загрузка из 1С', icon: '📥', group: 'Операции' },
    { href: '/admin/payments-import', label: 'Импорт оплат', icon: '📥', group: 'Операции' },
    { href: '/admin/enrollments', label: 'Заявки на обучение', icon: '🎓', group: 'Операции', flag: 'enrollment_requests' },
    { href: '/admin/audit', label: 'Аудит', icon: '🧾', group: 'Операции' },
    { href: '/admin/pii-access', label: 'Доступ к ПДн', icon: '🛡️', group: 'Операции' },
    { href: '/admin/users', label: 'Пользователи', icon: '👤', group: 'Справочники' },
    { href: '/admin/partners', label: 'Партнёры', icon: '🏢', group: 'Справочники' },
    { href: '/admin/organizations', label: 'Организации', icon: '🏛', group: 'Справочники' },
    { href: '/admin/training-directions', label: 'Направления обучения', icon: '🎯', group: 'Справочники' },
    { href: '/admin/custom-fields', label: 'Доп-поля', icon: '🧩', group: 'Справочники' },
    { href: '/admin/roles', label: 'Роли', icon: '🎭', group: 'Справочники', flag: 'role_constructor' },
    { href: '/admin/settings', label: 'Настройки', icon: '⚙', group: 'Платформа' }
  ],
  manager: [
    { href: '/manager/dashboard', label: 'Главная', icon: '⌂', flag: 'manager_cabinet' },
    { href: '/manager/orders', label: 'Заказы', icon: '📋', flag: 'manager_cabinet' },
    { href: '/manager/leads', label: 'Заявки', icon: '📬', flag: 'manager_cabinet' },
    { href: '/manager/funnel', label: 'Воронка', icon: '📈', flag: 'sales_funnel' },
    { href: '/manager/tasks', label: 'Задачи', icon: '✅', flag: 'internal_tasks' },
    { href: '/manager/organizations', label: 'Организации', icon: '🏢', flag: 'manager_cabinet' },
    { href: '/manager/finance', label: 'Финансы', icon: '₽', flag: 'manager_cabinet' },
    { href: '/manager/import', label: 'Загрузка из 1С', icon: '📥', flag: 'manager_cabinet' },
    { href: '/manager/payments-import', label: 'Импорт оплат', icon: '📥', flag: 'manager_cabinet' },
    { href: '/manager/documents', label: 'Документы', icon: '📄', flag: 'manager_cabinet' },
    { href: '/manager/students', label: 'Сотрудники', icon: '👥', flag: 'manager_cabinet' },
    { href: '/manager/enrollments', label: 'Заявки на обучение', icon: '🎓', flag: 'enrollment_requests' },
    { href: '/manager/messages', label: 'Сообщения', icon: '💬', flag: 'manager_cabinet' },
    { href: '/manager/inbox', label: 'Обращения', icon: '📨', flag: 'inbound_messaging' },
    { href: '/manager/calls', label: 'Звонки', icon: '☎️', flag: 'telephony_mango' },
    { href: '/manager/team', label: 'Команда', icon: '⚙', flag: 'manager_cabinet', leaderOnly: true, hiddenWhenFlag: 'leader_cabinet' },
    { href: '/leader/dashboard', label: 'Кабинет руководителя', icon: '⚙', flag: 'leader_cabinet', leaderOnly: true },
    { href: '/manager/settings', label: 'Настройки', icon: '⚙', flag: 'manager_cabinet' }
  ],
  // Пункты leader-меню намеренно БЕЗ flag: внутрь пускает middleware+layout;
  // флаг на каждом пункте дал бы пустой сайдбар при выключении.
  // ЗАВИСИМОСТЬ ФЛАГОВ: пункты-мосты в /manager/* (Сообщения, Мои заказы) живут под
  // флагом manager_cabinet — поэтому leader_cabinet включать ТОЛЬКО вместе с manager_cabinet,
  // иначе эти два пункта 404-ят. На практике лидер всегда и менеджер; см. runbook.
  leader: [
    { href: '/leader/dashboard', label: 'Сводка', icon: '⌂' },
    { href: '/leader/team', label: 'Команда', icon: '⚙' },
    { href: '/leader/finance', label: 'Финансы', icon: '₽' },
    { href: '/leader/commission-corrections', label: 'Корректировки', icon: '🔁' },
    { href: '/leader/orders', label: 'Заказы', icon: '📋' },
    { href: '/leader/organizations', label: 'Организации', icon: '🏢' },
    // role_constructor — отдельный feature-флаг (НЕ leader_cabinet): гейтит только
    // этот пункт, не опустошает сайдбар при выключении.
    { href: '/leader/roles', label: 'Роли', icon: '🎭', flag: 'role_constructor' },
    { href: '/leader/funnel', label: 'Воронка', icon: '📈', flag: 'sales_funnel' },
    { href: '/leader/analytics', label: 'Аналитика', icon: '📊', flag: 'leader_analytics' },
    { href: '/leader/tasks', label: 'Задачи', icon: '✅', flag: 'internal_tasks' },
    { href: '/leader/enrollments', label: 'Заявки на обучение', icon: '🎓', flag: 'enrollment_requests' },
    // Личный inbox (комментарии+чат) живёт в кабинете менеджера — см. план, «Отклонение от спеки».
    { href: '/manager/messages', label: 'Сообщения', icon: '💬' },
    // Переключатель «играющего тренера» в личный кабинет менеджера.
    { href: '/manager/dashboard', label: 'Мои заказы', icon: '↩' },
    { href: '/leader/settings', label: 'Настройки', icon: '⚙' }
  ],
  partner: [
    { href: '/partner/dashboard', label: 'Главная' },
    { href: '/partner/portfolio', label: 'Портфель' },
    { href: '/partner/deals', label: 'Заказы' },
    { href: '/partner/leads', label: 'Заявки', flag: 'partner_leads' },
    { href: '/partner/enrollments', label: 'Заявки на обучение', flag: 'enrollment_requests' },
    { href: '/partner/documents', label: 'Документы' },
    { href: '/partner/finance', label: 'Финансы' },
    { href: '/partner/team', label: 'Команда', partnerAdminOnly: true },
    { href: '/partner/messages', label: 'Сообщения', flag: 'chat' },
    { href: '/partner/settings', label: 'Настройки' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Главная', icon: '⌂', flag: 'organization_cabinet' },
    { href: '/organization/orders', label: 'Заказы', icon: '📋', flag: 'organization_cabinet' },
    { href: '/organization/documents', label: 'Документы', icon: '📄', flag: 'organization_cabinet' },
    { href: '/organization/finance', label: 'Финансы', icon: '₽', flag: 'organization_cabinet' },
    { href: '/organization/students', label: 'Сотрудники', icon: '👥', flag: 'organization_cabinet' },
    { href: '/organization/enrollments', label: 'Заявки на обучение', icon: '🎓', flag: 'enrollment_requests' },
    { href: '/organization/team', label: 'Команда', icon: '⚙', orgAdminOrLeaderOnly: true, flag: 'organization_cabinet' },
    // «Сообщения» намеренно под более узким флагом chat (см. CLAUDE.md §5);
    // /student — отдельный shared-entry домен, не часть organization_cabinet.
    { href: '/organization/messages', label: 'Сообщения', icon: '💬', flag: 'chat' },
    { href: '/student', label: 'Кабинет слушателя', icon: '🎓' },
    { href: '/organization/settings', label: 'Настройки', icon: '⚙', flag: 'organization_cabinet' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};

/**
 * Returns the static menu for a role minus items whose feature flag is off,
 * items marked `leaderOnly` when the caller is not a manager-leader, and items
 * marked `partnerAdminOnly` when the caller is not a partner-admin. Both
 * `isManagerLeader` and `isPartnerAdmin` default to false, so callers that
 * don't pass them simply hide the elevated items — that's the safe default.
 *
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(
  role: Role | 'leader',
  opts?: { isManagerLeader?: boolean; isPartnerAdmin?: boolean }
): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    if (item.partnerAdminOnly && !opts?.isPartnerAdmin) return false;
    if (item.hiddenWhenFlag && isFeatureEnabled(item.hiddenWhenFlag)) return false;
    return true;
  });
}
