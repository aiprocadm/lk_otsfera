import type { IconKey } from './icons';

/**
 * Словарь разделов: ключ → название и значок (`У-106`).
 *
 * **Зачем.** Раньше название раздела было строкой в реестре меню каждой роли.
 * Один и тот же экран приходилось называть заново шесть раз, и он расходился:
 * «Комиссии» у администратора против «Комиссионных отчётов» в разговоре,
 * «Импорт оплат» у менеджера против «Выписки (сч. 51)» у администратора.
 * Держалось это на внимательности — и не удержалось.
 *
 * Теперь пункт меню объявляет **ключ раздела**, а название и значок берёт
 * отсюда. Разъехаться им негде: строка одна на всю систему.
 *
 * **Правило добавления.** Новый раздел — новый ключ здесь и только здесь. Если
 * кажется, что нужен «тот же раздел, но с другим названием», — это два разных
 * раздела, и у них два разных ключа (так живут пункты-мосты между кабинетами:
 * `leaderCabinet`, `myOrders`). Одно название на два ключа запрещено стражем
 * `navigation.same-section-same-name.guardrail`.
 */
export type SectionKey =
  | 'dashboard'
  | 'search'
  | 'orders'
  | 'myOrders'
  | 'leads'
  | 'requests'
  | 'intake'
  | 'funnel'
  | 'deals'
  | 'tasks'
  | 'calendar'
  | 'organizations'
  | 'partners'
  | 'portfolio'
  | 'myOrganization'
  | 'enrollments'
  | 'certificates'
  | 'documents'
  | 'finance'
  | 'commissions'
  | 'corrections'
  | 'import'
  | 'paymentsImport'
  | 'sync'
  | 'integrations'
  | 'messages'
  | 'inbox'
  | 'calls'
  | 'analytics'
  | 'team'
  | 'users'
  | 'roles'
  | 'trainingDirections'
  | 'customFields'
  | 'orderStatuses'
  | 'audit'
  | 'piiAccess'
  | 'health'
  | 'settings'
  | 'leaderCabinet'
  | 'studentCabinet'
  | 'learning'
  | 'help';

export type SectionMeta = { label: string; iconKey: IconKey };

/**
 * Названия — из глоссария (`У-76`). Переименования `У-107` сделаны здесь, и
 * этого достаточно: пункт меню, заголовок страницы и хлебная крошка берут
 * строку отсюда.
 */
export const SECTIONS: Record<SectionKey, SectionMeta> = {
  dashboard: { label: 'Главная', iconKey: 'dashboard' },
  search: { label: 'Поиск', iconKey: 'search' },

  // ── Работа и продажи ──────────────────────────────────────────────────────
  orders: { label: 'Заказы', iconKey: 'orders' },
  // Пункт-мост из кабинета руководителя в менеджерский. Снимается в PR-3
  // этапа 3 (`У-111`) вместе с появлением переключателя кабинетов в шапке.
  myOrders: { label: 'Мои заказы', iconKey: 'myOrders' },
  leads: { label: 'Лиды', iconKey: 'leads' },
  requests: { label: 'Обращения', iconKey: 'requests' },
  intake: { label: 'Входящие в работу', iconKey: 'intake' },
  // `У-107`: было «Воронка» — не сказано, воронка чего.
  funnel: { label: 'Воронка продаж', iconKey: 'funnel' },
  deals: { label: 'Сделки', iconKey: 'deals' },
  tasks: { label: 'Задачи', iconKey: 'tasks' },
  calendar: { label: 'Календарь', iconKey: 'calendar' },

  // ── Клиенты ───────────────────────────────────────────────────────────────
  organizations: { label: 'Организации', iconKey: 'organizations' },
  partners: { label: 'Партнёры', iconKey: 'partners' },
  portfolio: { label: 'Портфель', iconKey: 'portfolio' },
  myOrganization: { label: 'Моя организация', iconKey: 'myOrganization' },
  enrollments: { label: 'Заявки на обучение', iconKey: 'enrollments' },
  certificates: { label: 'Удостоверения', iconKey: 'certificates' },

  // ── Документы и финансы ───────────────────────────────────────────────────
  documents: { label: 'Документы', iconKey: 'documents' },
  finance: { label: 'Финансы', iconKey: 'finance' },
  // `У-107`: было «Комиссии» — слово означает и деньги, и документ.
  commissions: { label: 'Комиссионные отчёты', iconKey: 'commissions' },
  // `У-107`: было «Корректировки» — корректировки чего.
  corrections: { label: 'Корректировки комиссии', iconKey: 'corrections' },

  // ── Обмен с 1С ────────────────────────────────────────────────────────────
  // `У-107`: было «Загрузка из 1С» — не отличить от выписки, тоже «из 1С».
  import: { label: 'Загрузка Excel из 1С', iconKey: 'import' },
  // `У-107`: было «Импорт оплат» у менеджера и «Выписка (сч. 51)» у админа —
  // один экран под двумя именами.
  paymentsImport: { label: 'Выписка по счёту 51', iconKey: 'paymentsImport' },
  // `У-107`: было «Синхронизация (авто)».
  sync: { label: 'Автообмен с 1С', iconKey: 'sync' },
  integrations: { label: 'Интеграции', iconKey: 'integrations' },

  // ── Коммуникации ──────────────────────────────────────────────────────────
  messages: { label: 'Сообщения', iconKey: 'messages' },
  inbox: { label: 'Входящие письма', iconKey: 'inbox' },
  calls: { label: 'Звонки', iconKey: 'calls' },

  // ── Аналитика и команда ───────────────────────────────────────────────────
  analytics: { label: 'Аналитика', iconKey: 'analytics' },
  team: { label: 'Команда', iconKey: 'team' },

  // ── Справочники и платформа ───────────────────────────────────────────────
  users: { label: 'Пользователи', iconKey: 'users' },
  // `У-107`: было «Роли» — речь о конструкторе прав доступа.
  roles: { label: 'Роли доступа', iconKey: 'roles' },
  trainingDirections: { label: 'Направления обучения', iconKey: 'trainingDirections' },
  // `У-107`: было «Доп-поля» — сокращение в интерфейсе.
  customFields: { label: 'Дополнительные поля', iconKey: 'customFields' },
  orderStatuses: { label: 'Статусы заявок', iconKey: 'orderStatuses' },
  audit: { label: 'Аудит', iconKey: 'audit' },
  // `У-107`: было «Доступ к ПДн» — аббревиатура в интерфейсе.
  piiAccess: { label: 'Доступ к персональным данным', iconKey: 'security' },
  // `У-107`: было «Здоровье».
  health: { label: 'Здоровье системы', iconKey: 'health' },
  settings: { label: 'Настройки', iconKey: 'settings' },

  // ── Входы в соседние кабинеты ─────────────────────────────────────────────
  // Пункт-мост из кабинета менеджера. Снимается в PR-3 этапа 3 (`У-111`).
  leaderCabinet: { label: 'Кабинет руководителя', iconKey: 'leaderCabinet' },
  studentCabinet: { label: 'Кабинет слушателя', iconKey: 'studentCabinet' },
  learning: { label: 'Обучение', iconKey: 'learning' },
  help: { label: 'Справка', iconKey: 'help' },
};

/** Название раздела по ключу — для заголовков и крошек. */
export function sectionLabel(key: SectionKey): string {
  return SECTIONS[key].label;
}
