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
 * `documents`, `messages`). Одно название на два ключа запрещено стражем
 * `navigation.same-section-same-name.guardrail`.
 */
export type SectionKey =
  | 'dashboard'
  | 'search'
  | 'orders'
  | 'leads'
  | 'requests'
  | 'intake'
  | 'funnel'
  | 'deals'
  | 'tasks'
  | 'calendar'
  | 'organizations'
  // Этап 1 ТЗ 12.09.2026 (`У-178`): справочник контактов — люди клиентов.
  | 'contacts'
  | 'partners'
  | 'portfolio'
  // Этап 6 ТЗ 12.09.2026 (`У-237`): материалы для партнёров.
  | 'materials'
  | 'myOrganization'
  | 'enrollments'
  | 'certificates'
  | 'documents'
  | 'finance'
  | 'commissions'
  | 'corrections'
  | 'exchange'
  | 'messages'
  | 'inbox'
  | 'messengers'
  | 'calls'
  | 'analytics'
  | 'team'
  | 'users'
  | 'trainingDirections'
  | 'audit'
  | 'piiAccess'
  | 'settings'
  | 'notifications'
  | 'studentCabinet'
  | 'learning'
  | 'myProfile'
  | 'help';

export type SectionMeta = { label: string; iconKey: IconKey };

/**
 * Названия — из глоссария (`У-76`). Переименования `У-107` сделаны здесь, и
 * этого достаточно: пункт меню, заголовок страницы и хлебная крошка берут
 * строку отсюда.
 */
/**
 * `У-262`: из словаря убраны девять ключей — `sync`, `import`, `paymentsImport`,
 * `roles`, `security`, `health`, `integrations`, `customFields`,
 * `orderStatuses`. Ими подписывались пункты меню, которые заменил хаб
 * «Настройки»: при включённом флаге `settings_hub` они прятались, а флаг был
 * включён везде — то есть пункты не показывались никому. Флаг снят, пункты
 * удалены, и ключи остались без потребителя (страж значков это и поймал).
 * Разделы хаба хранят свои названия в реестре `settings.ts`.
 */
export const SECTIONS: Record<SectionKey, SectionMeta> = {
  dashboard: { label: 'Главная', iconKey: 'dashboard' },
  search: { label: 'Поиск', iconKey: 'search' },

  // ── Работа и продажи ──────────────────────────────────────────────────────
  orders: { label: 'Заказы', iconKey: 'orders' },
  // Пункт-мост из кабинета руководителя в менеджерский. Снимается в PR-3
  // этапа 3 (`У-111`) вместе с появлением переключателя кабинетов в шапке.
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
  contacts: { label: 'Контакты', iconKey: 'contacts' },
  partners: { label: 'Партнёры', iconKey: 'partners' },
  portfolio: { label: 'Портфель', iconKey: 'portfolio' },
  materials: { label: 'Материалы', iconKey: 'materials' },
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

  // `У-113`: у менеджера две загрузки схлопнуты в один раздел с вкладками —
  // человеку не нужно помнить, что обмен «размазан» по двум пунктам меню.
  exchange: { label: 'Обмен с 1С', iconKey: 'exchange' },

  // ── Коммуникации ──────────────────────────────────────────────────────────
  messages: { label: 'Сообщения', iconKey: 'messages' },
  inbox: { label: 'Входящие письма', iconKey: 'inbox' },
  // Спека 2026-09-12: переписка с клиентами в Telegram / MAX / WhatsApp —
  // диалоги, а не разбор писем («Входящие письма») и не чат по заказу («Сообщения»).
  messengers: { label: 'Мессенджеры', iconKey: 'messengers' },
  calls: { label: 'Звонки', iconKey: 'calls' },

  // ── Аналитика и команда ───────────────────────────────────────────────────
  analytics: { label: 'Аналитика', iconKey: 'analytics' },
  team: { label: 'Команда', iconKey: 'team' },

  // ── Справочники и платформа ───────────────────────────────────────────────
  users: { label: 'Пользователи', iconKey: 'users' },
  trainingDirections: { label: 'Направления обучения', iconKey: 'trainingDirections' },
  audit: { label: 'Аудит', iconKey: 'audit' },
  // `У-107`: было «Доступ к ПДн» — аббревиатура в интерфейсе.
  piiAccess: { label: 'Доступ к персональным данным', iconKey: 'security' },
  settings: { label: 'Настройки', iconKey: 'settings' },
  // Этап 5 ТЗ 12.09.2026 (`У-228`): лента уведомлений, одна на шесть кабинетов,
  // закреплена внизу над «Настройками».
  notifications: { label: 'Уведомления', iconKey: 'notifications' },

  // ── Входы в соседние кабинеты ─────────────────────────────────────────────
  // Пункт-мост из кабинета менеджера. Снимается в PR-3 этапа 3 (`У-111`).
  studentCabinet: { label: 'Кабинет слушателя', iconKey: 'studentCabinet' },
  learning: { label: 'Обучение', iconKey: 'learning' },
  // Этап 2 ТЗ 13.10.2026 (`У-284`): профиль слушателя — ФИО, организация,
  // обучения со сроками и удостоверения.
  myProfile: { label: 'Мой профиль', iconKey: 'myProfile' },
  help: { label: 'Справка', iconKey: 'help' },
};

/** Название раздела по ключу — для заголовков и крошек. */
export function sectionLabel(key: SectionKey): string {
  return SECTIONS[key].label;
}
