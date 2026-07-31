/**
 * §25.7: реестр контекстов доступа к ПДн — единая точка правды.
 * Кормит: (1) guardrail-тест полноты call-sites, (2) RU-лейблы фильтров
 * /admin/pii-access, (3) subjectType/action события (хелпер recordPiiAccess
 * берёт их отсюда — рассинхрон невозможен).
 * Новое staff-чтение ПДн физлиц клиентского контура ОБЯЗАНО зарегистрировать
 * контекст здесь и вызвать recordPiiAccess (CLAUDE.md §12).
 */

export type PiiSubjectType =
  | 'student'
  | 'lead'
  | 'enrollment_request'
  | 'client_request'
  | 'user'
  | 'caller'
  | 'inbound_sender';

/** Этап 9 (ФТ-12.1, PR-3): `export` — выгрузка ПДн сотрудником в файл.
 *  Клиентские выгрузки собственных данных сюда не попадают (фильтр `isStaff`
 *  внутри `recordPiiAccess`). */
export type PiiAction = 'list' | 'view' | 'export';

export type PiiContext = {
  subjectType: PiiSubjectType;
  action: PiiAction;
  labelRu: string;
  /** Файл сервиса, обязанный вызывать recordPiiAccess с этим контекстом. */
  callSite: string;
};

export const PII_CONTEXTS = {
  manager_students_list: {
    subjectType: 'student',
    action: 'list',
    labelRu: 'Список слушателей',
    callSite: 'src/lib/services/manager/students.ts',
  },
  manager_student_view: {
    subjectType: 'student',
    action: 'view',
    labelRu: 'Карточка слушателя',
    callSite: 'src/lib/services/manager/students.ts',
  },
  manager_lead_view: {
    subjectType: 'lead',
    action: 'view',
    labelRu: 'Карточка лида (контакты)',
    callSite: 'src/lib/services/manager/leads.ts',
  },
  enrollments_list: {
    subjectType: 'enrollment_request',
    action: 'list',
    labelRu: 'Заявки на обучение',
    callSite: 'src/lib/services/enrollments/list.ts',
  },
  enrollment_detail: {
    subjectType: 'enrollment_request',
    action: 'view',
    labelRu: 'Деталка заявки на обучение',
    callSite: 'src/lib/services/enrollments/detail.ts',
  },
  client_requests_list: {
    subjectType: 'client_request',
    action: 'list',
    labelRu: 'Обращения клиентов',
    callSite: 'src/lib/services/clientRequests/list.ts',
  },
  client_request_view: {
    subjectType: 'client_request',
    action: 'view',
    labelRu: 'Деталка обращения клиента',
    callSite: 'src/lib/services/clientRequests/list.ts',
  },
  enrollment_wizard_students: {
    subjectType: 'student',
    action: 'list',
    labelRu: 'Мастер заявки: выбор слушателей',
    callSite: 'src/app/api/enrollments/students/route.ts',
  },
  org_card_inbound: {
    subjectType: 'inbound_sender',
    action: 'list',
    labelRu: 'Карточка организации: входящие',
    callSite: 'src/lib/services/manager/organizationCard.ts',
  },
  org_card_calls: {
    subjectType: 'caller',
    action: 'list',
    labelRu: 'Карточка организации: звонки',
    callSite: 'src/lib/services/manager/organizationCard.ts',
  },
  inbox_list: {
    subjectType: 'inbound_sender',
    action: 'list',
    labelRu: 'Инбокс: входящие',
    callSite: 'src/lib/services/inbound/listInbox.ts',
  },
  calls_list: {
    subjectType: 'caller',
    action: 'list',
    labelRu: 'Журнал звонков',
    callSite: 'src/lib/services/telephony/listCalls.ts',
  },
  // Этап 7 (ФТ-8.1): union-список Intake показывает контакты обращений/звонков.
  intake_list: {
    subjectType: 'inbound_sender',
    action: 'list',
    labelRu: 'Входящие в работу',
    callSite: 'src/lib/services/intake/list.ts',
  },
  deal_activity_inbound: {
    subjectType: 'inbound_sender',
    action: 'list',
    labelRu: 'Активность сделки: входящие',
    callSite: 'src/lib/services/manager/dealActivity.ts',
  },
  deal_activity_calls: {
    subjectType: 'caller',
    action: 'list',
    labelRu: 'Активность сделки: звонки',
    callSite: 'src/lib/services/manager/dealActivity.ts',
  },
  certificates_list: {
    subjectType: 'student',
    action: 'list',
    labelRu: 'Удостоверения',
    callSite: 'src/lib/services/training/certificates.ts',
  },
  order_items_list: {
    subjectType: 'student',
    action: 'list',
    labelRu: 'Слушатели заказа',
    callSite: 'src/lib/services/training/orderItems.ts',
  },
  admin_users_list: {
    subjectType: 'user',
    action: 'list',
    labelRu: 'Пользователи (список)',
    callSite: 'src/lib/services/admin/users/queries.ts',
  },
  admin_user_view: {
    subjectType: 'user',
    action: 'view',
    labelRu: 'Карточка пользователя',
    callSite: 'src/lib/services/admin/users/queries.ts',
  },
  global_search_students: {
    subjectType: 'student',
    action: 'list',
    labelRu: 'Глобальный поиск: слушатели',
    callSite: 'src/lib/services/search/globalSearch.ts',
  },
  // Этап 9 (ФТ-12.2, PR-3): выгрузка удостоверений из карточки организации —
  // единственная staff-выгрузка с ПДн физлиц. Клиентские реестры (organization/
  // partner) выгружают свои данные и по ФТ-12.1 не журналируются.
  org_card_certificates_export: {
    subjectType: 'student',
    action: 'export',
    labelRu: 'Карточка организации: выгрузка удостоверений',
    callSite: 'src/app/api/manager/organizations/[id]/certificates/export/route.ts',
  },
} as const satisfies Record<string, PiiContext>;

export type PiiContextKey = keyof typeof PII_CONTEXTS;
