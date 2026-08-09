/**
 * Реестр значков разделов (`У-5`, этап 2 ТЗ понятности).
 *
 * **Единственный источник правды.** Ключ — **семантика раздела**, а не роль:
 * «Организации» выглядят одинаково и у админа, и у менеджера, потому что обе
 * роли берут `organizations` отсюда, а не подбирают эмодзи на глаз.
 *
 * Инвариант держит страж `navigation.icons.guardrail`: одинаковое название
 * пункта ⟹ одинаковый `iconKey`, одинаковый `iconKey` ⟹ одинаковое название
 * (`У-9`). Поэтому **два раздела с разными названиями не могут делить ключ** —
 * если новому пункту «почти подходит» существующий ключ, но название другое,
 * заводи новый ключ, а не переиспользуй похожий.
 *
 * Ловушки, на которые уже наступали при заведении реестра:
 * - `🤝` занят «Сделками», поэтому «Партнёры» получили `🏬`, а не «рукопожатие»;
 * - `👥` занят «Сотрудниками» (учащиеся клиента), поэтому «Команда» (сотрудники
 *   кабинета) — `👔`;
 * - `👤` занят «Пользователями», поэтому «Кабинет слушателя» — `🎒`.
 */
export const NAV_ICONS = {
  // Общее
  dashboard: '⌂',
  search: '🔎',
  settings: '⚙',

  // Работа с заказами и продажами
  orders: '📋',
  myOrders: '↩',
  leads: '📬',
  requests: '📮',
  intake: '📥',
  funnel: '📈',
  deals: '🤝',
  tasks: '✅',
  calendar: '📅',

  // Клиенты и люди
  organizations: '🏢',
  partners: '🏬',
  employees: '👥',
  team: '👔',
  users: '👤',
  portfolio: '💼',

  // Деньги
  finance: '₽',
  commissions: '💰',
  corrections: '🔁',

  // Документы и обучение
  documents: '📄',
  enrollments: '🎓',
  certificates: '📜',
  learning: '📚',
  studentCabinet: '🎒',

  // Коммуникации
  messages: '💬',
  inbox: '📨',
  calls: '☎️',

  // Обмен с 1С и данные
  sync: '🔄',
  import: '📤',
  bankStatement: '🏦',
  paymentsImport: '💳',

  // Служебное и справочники
  leaderCabinet: '🧭',
  roles: '🎭',
  security: '🛡️',
  audit: '🧾',
  health: '💚',
  integrations: '🔌',
  trainingDirections: '🎯',
  customFields: '🧩',
  orderStatuses: '🚦',
  analytics: '📊',
} as const;

export type IconKey = keyof typeof NAV_ICONS;

/** Значок раздела по семантическому ключу. */
export function navIcon(key: IconKey): string {
  return NAV_ICONS[key];
}
