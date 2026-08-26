import type { SectionKey } from './sectionLabels';

/**
 * Список исключений из правила зеркала (`У-121`, §0.2 действующего ТЗ).
 *
 * **Правило.** Кабинеты сотрудников учебного центра (администратор,
 * руководитель, менеджер) зеркальны между собой; кабинеты клиентов (заказчик,
 * партнёр) — между собой. Один и тот же раздел называется одинаково, стоит на
 * одном месте, носит один значок и лежит в одной группе. Различаться могут
 * объём данных и права — но не устройство меню.
 *
 * **Зачем список.** Часть расхождений настоящие: партнёрами управляет учебный
 * центр, а не менеджер; платформенные разделы есть только у администратора.
 * Без списка страж пришлось бы или отключить, или «позеленить» подгонкой — и
 * оба пути возвращают нас к тому, с чего начали. Поэтому каждое расхождение
 * записано здесь **с причиной**, и любое НЕзаписанное роняет сборку.
 *
 * Список — часть приёмки: заказчик видит его целиком и может потребовать
 * выровнять строку вместо того, чтобы её сюда записывать.
 */
export type MirrorPair = 'staff' | 'clients';

export type MirrorException = {
  /** Пара кабинетов, внутри которой допускается расхождение. */
  pair: MirrorPair;
  /** Ключ раздела — тот же, что в реестре меню. */
  sectionKey: SectionKey;
  /** Кабинеты, у которых раздел ЕСТЬ. У остальных из пары его нет — это и есть исключение. */
  cabinets: string[];
  /** Почему так, простыми словами. Пустая строка не допускается — страж это проверяет. */
  reason: string;
};

export const MIRROR_PAIRS: Record<MirrorPair, string[]> = {
  staff: ['admin', 'leader', 'manager'],
  clients: ['organization', 'partner'],
};

export const MIRROR_EXCEPTIONS: MirrorException[] = [
  // ——— Кабинеты сотрудников учебного центра ———
  {
    pair: 'staff',
    sectionKey: 'partners',
    cabinets: ['admin'],
    reason:
      'Партнёрами управляет учебный центр целиком; у менеджера и руководителя такой власти нет',
  },
  {
    pair: 'staff',
    sectionKey: 'users',
    cabinets: ['admin'],
    reason: 'Учётные записи всей платформы — только администратор (Model A)',
  },
  {
    pair: 'staff',
    sectionKey: 'health',
    cabinets: ['admin'],
    reason: 'Здоровье платформы: чужой кабинет ею не управляет',
  },
  {
    pair: 'staff',
    sectionKey: 'audit',
    cabinets: ['admin'],
    reason: 'Журнал действий всей платформы — надзорный раздел администратора',
  },
  {
    pair: 'staff',
    sectionKey: 'piiAccess',
    cabinets: ['admin'],
    reason: 'Журнал доступа к персональным данным — надзорный раздел администратора',
  },
  {
    pair: 'staff',
    sectionKey: 'integrations',
    cabinets: ['admin'],
    reason: 'Подключения к внешним системам общие для платформы; компании их не настраивают',
  },
  {
    pair: 'staff',
    sectionKey: 'sync',
    cabinets: ['admin'],
    reason: 'Расписания автообмена с 1С общие для платформы (решение `Р-22`)',
  },
  {
    pair: 'staff',
    sectionKey: 'import',
    cabinets: ['admin'],
    reason:
      'Загрузка файлов 1С у менеджера живёт в разделе «Обмен с 1С» (`У-113`), у админа — в настройках платформы',
  },
  {
    pair: 'staff',
    sectionKey: 'paymentsImport',
    cabinets: ['admin'],
    reason:
      'Выписка по счёту 51 у менеджера — вкладка «Обмена с 1С» (`У-113`), у админа — раздел настроек платформы',
  },
  {
    pair: 'staff',
    sectionKey: 'commissions',
    cabinets: ['admin'],
    reason:
      'Комиссионные отчёты партнёров выпускает учебный центр; менеджер и руководитель их не ведут',
  },
  {
    pair: 'staff',
    sectionKey: 'corrections',
    cabinets: ['admin', 'leader'],
    reason:
      'Правка начисленной комиссии — решение руководителя и администратора, не рядового менеджера',
  },
  {
    pair: 'staff',
    sectionKey: 'trainingDirections',
    cabinets: ['admin'],
    reason: 'Справочник направлений обучения общий для платформы',
  },
  {
    pair: 'staff',
    sectionKey: 'customFields',
    cabinets: ['admin', 'leader'],
    reason:
      'Настраиваемые поля своей компании ведёт руководитель, платформенные — администратор; менеджер их не настраивает',
  },
  {
    pair: 'staff',
    sectionKey: 'orderStatuses',
    cabinets: ['admin', 'leader'],
    reason:
      'Статусы заказов настраивает руководитель компании и администратор; менеджер по ним работает',
  },
  {
    pair: 'staff',
    sectionKey: 'roles',
    cabinets: ['admin', 'leader'],
    reason: 'Профили доступа раздаёт руководитель и администратор; менеджер их не раздаёт',
  },
  {
    pair: 'staff',
    sectionKey: 'team',
    cabinets: ['leader', 'manager'],
    reason:
      'Состав команды компании ведёт руководитель; у менеджера пункт — свой список коллег, у админа его место занимают «Пользователи»',
  },
  {
    pair: 'staff',
    sectionKey: 'analytics',
    cabinets: ['leader'],
    reason:
      'Сводная аналитика компании — обзор руководителя; у менеджера её место занимает своя главная',
  },
  {
    pair: 'staff',
    sectionKey: 'funnel',
    cabinets: ['leader', 'manager'],
    reason: 'Воронка продаж — работа продающего контура; администратор в ней не работает (Model A)',
  },
  {
    pair: 'staff',
    sectionKey: 'deals',
    cabinets: ['leader', 'manager'],
    reason: 'Сделки — работа продающего контура; администратор в ней не работает (Model A)',
  },
  {
    pair: 'staff',
    sectionKey: 'tasks',
    cabinets: ['leader', 'manager'],
    reason:
      'Задачи — личная работа продающего контура; у администратора личных задач по клиентам нет',
  },
  {
    pair: 'staff',
    sectionKey: 'calendar',
    cabinets: ['leader', 'manager'],
    reason: 'Календарь — личная работа продающего контура, как и «Задачи»',
  },
  {
    pair: 'staff',
    sectionKey: 'leads',
    cabinets: ['manager'],
    reason:
      'Лиды партнёров разбирает менеджер; руководитель видит их в воронке, администратор — в надзорных разделах',
  },
  {
    pair: 'staff',
    sectionKey: 'exchange',
    cabinets: ['manager'],
    reason:
      'Обмен с 1С в кабинете менеджера (`У-113`) — рабочий раздел; у администратора те же вкладки лежат в настройках платформы',
  },
  {
    pair: 'staff',
    sectionKey: 'inbox',
    cabinets: ['manager'],
    reason:
      'Разбор входящей почты — работа менеджера; руководитель и администратор её не разбирают',
  },
  {
    pair: 'staff',
    sectionKey: 'calls',
    cabinets: ['manager'],
    reason: 'Записи звонков слушает тот, кто звонил, — менеджер',
  },

  // ——— Кабинеты клиентов ———
  {
    pair: 'clients',
    sectionKey: 'myOrganization',
    cabinets: ['organization'],
    reason:
      'У заказчика это его собственная организация; у партнёра на том же месте стоит «Портфель» — список чужих организаций',
  },
  {
    pair: 'clients',
    sectionKey: 'portfolio',
    cabinets: ['partner'],
    reason:
      'Зеркальная половина предыдущей строки: у партнёра список его клиентов, у заказчика — своя организация',
  },
  {
    pair: 'clients',
    sectionKey: 'studentCabinet',
    cabinets: ['organization'],
    reason: 'Вход в кабинет слушателя: обучаются сотрудники заказчика, у партнёра обучаемых нет',
  },
];
