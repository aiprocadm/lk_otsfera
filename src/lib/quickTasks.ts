import { isFeatureEnabled } from '@/lib/featureFlags';

/**
 * «Частые задачи» стартового экрана (`У-71`, этап 9).
 *
 * Раньше на входе человека встречали счётчики: «заказов 12, долг 340 000».
 * Это отвечает на вопрос «как дела», но не на вопрос «что мне сейчас делать».
 * Блок отвечает именно на второй — прямыми действиями роли.
 *
 * Одноразовый welcome-блок (этап 4) заменён этим: он показывался один раз и
 * скрывался навсегда, то есть переставал помогать ровно тогда, когда человек
 * осваивался и начинал искать «где тут подать заявку».
 *
 * Плитки, ведущие в разделы под флагом, исчезают вместе с разделом — иначе
 * кнопка вела бы в 404.
 */
export type QuickTask = {
  href: string;
  title: string;
  /** Одна строка: что произойдёт после нажатия. */
  hint: string;
  /**
   * Подпись кнопки, которую человек ищет на экране назначения (`У-105`).
   *
   * Плитка не имеет права обещать действие, которого на экране нет: это
   * тупик, а не подсказка. Страж `navigation.quick-tasks.guardrail`
   * открывает страницу назначения вместе с её компонентами и требует, чтобы
   * подпись там действительно нашлась. Плитки-переходы («Документы»,
   * «Проверить долги») действия не обещают и поля не имеют.
   */
  action?: string;
};

export type QuickTasksRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization';

/**
 * Слушателя здесь нет намеренно: его кабинет — один экран с единственной
 * кнопкой «Перейти к обучению», и блок задач был бы копией этой кнопки.
 */
export function quickTasksFor(role: QuickTasksRole): QuickTask[] {
  const tasks = BUILDERS[role]();
  return tasks.slice(0, 6);
}

const BUILDERS: Record<QuickTasksRole, () => QuickTask[]> = {
  partner: () => {
    const t: QuickTask[] = [];
    if (isFeatureEnabled('enrollment_requests')) {
      t.push({
        href: '/partner/enrollments',
        title: 'Подать заявку на обучение',
        hint: 'Список сотрудников и направление обучения',
        action: 'Подать заявку на обучение',
      });
    }
    // `У-105` дословно: у партнёра плитка ведёт в «Портфель» с подсказкой
    // «откройте организацию → Сотрудники». Кнопка живёт внутри карточки
    // конкретного клиента, а какого — знает только человек, поэтому подсказка
    // и договаривает недостающий шаг. Страж знает про это исключение.
    t.push({
      href: '/partner/portfolio',
      title: 'Добавить сотрудника',
      hint: 'Откройте организацию → вкладка «Сотрудники»',
    });
    if (isFeatureEnabled('certificates_registry')) {
      t.push({
        href: '/partner/certificates',
        title: 'Посмотреть удостоверения',
        hint: 'Кто обучен и когда истекает срок',
      });
    }
    t.push(
      {
        href: '/partner/finance',
        title: 'Проверить начисления',
        hint: 'Комиссия по периодам, оплаты и задолженность',
      },
      { href: '/partner/documents', title: 'Документы', hint: 'Договоры, счета и акты' }
    );
    return t;
  },

  organization: () => {
    const t: QuickTask[] = [];
    if (isFeatureEnabled('enrollment_requests')) {
      t.push({
        href: '/organization/enrollments',
        title: 'Подать заявку на обучение',
        hint: 'Список сотрудников и направление обучения',
        action: 'Подать заявку на обучение',
      });
    }
    // `У-105`: плитка ведёт на вкладку «Сотрудники» своей организации —
    // именно там стоит обещанная кнопка (`У-100`).
    t.push({
      href: '/organization/company',
      title: 'Добавить сотрудника',
      hint: 'В справочник, чтобы выбирать его в заявках',
      action: 'Добавить сотрудника',
    });
    if (isFeatureEnabled('certificates_registry')) {
      t.push({
        href: '/organization/certificates',
        title: 'Посмотреть удостоверения',
        hint: 'Кто обучен и когда истекает срок',
      });
    }
    t.push(
      {
        href: '/organization/finance',
        title: 'Проверить оплаты',
        hint: 'Что оплачено и что должны',
      },
      { href: '/organization/documents', title: 'Документы', hint: 'Договоры, счета и акты' }
    );
    return t;
  },

  manager: () => {
    const t: QuickTask[] = [];
    if (isFeatureEnabled('intake_inbox')) {
      t.push({
        href: '/manager/intake',
        title: 'Разобрать входящие',
        hint: 'Обращения, заявки, письма и звонки в одной очереди',
      });
    }
    if (isFeatureEnabled('deals_pipeline')) {
      t.push({
        href: '/manager/deals',
        title: 'Создать сделку',
        hint: 'Переговоры со стадиями на доске',
        action: 'Новая сделка',
      });
    }
    t.push(
      {
        // `У-113`: обмен с 1С стал одним разделом с вкладками — плитка ведёт
        // на нужную вкладку, а не на бывший экран (он теперь шлюз).
        href: '/manager/exchange/excel',
        title: 'Загрузить данные из 1С',
        hint: 'Клиенты и заказы из выгрузки',
        action: 'Загрузить и проверить',
      },
      {
        href: '/manager/exchange/payments',
        title: 'Разнести оплаты из банка',
        hint: 'Выписка по счёту 51',
        action: 'Загрузить и проверить',
      },
      { href: '/manager/organizations', title: 'Найти клиента', hint: 'Карточка со всей историей' }
    );
    return t;
  },

  leader: () => {
    const t: QuickTask[] = [
      {
        href: '/leader/team',
        title: 'Посмотреть команду',
        hint: 'Нагрузка и результаты менеджеров',
      },
      { href: '/leader/orders', title: 'Заказы компании', hint: 'Все заказы, а не только свои' },
      { href: '/leader/finance', title: 'Проверить долги', hint: 'Кто не оплатил и на сколько' },
    ];
    if (isFeatureEnabled('leader_analytics')) {
      t.push({ href: '/leader/analytics', title: 'Аналитика', hint: 'План и факт продаж' });
    }
    t.push({
      href: '/leader/settings/integrations/1c',
      title: 'Обмен с 1С',
      hint: 'Загрузка данных и разнесение оплат',
    });
    return t;
  },

  admin: () => [
    {
      href: '/admin/users',
      title: 'Завести пользователя',
      hint: 'Доступ в кабинет и роль',
      action: 'Пригласить',
    },
    { href: '/admin/organizations', title: 'Организации', hint: 'Клиенты и их реквизиты' },
    {
      href: '/admin/settings/integrations/1c',
      title: 'Обмен с 1С',
      hint: 'Загрузка данных и разнесение оплат',
    },
    {
      href: '/admin/settings/system/feature-flags',
      title: 'Функции платформы',
      hint: 'Что включено в системе',
    },
    { href: '/admin/audit', title: 'Журнал действий', hint: 'Кто и что менял' },
  ],
};
