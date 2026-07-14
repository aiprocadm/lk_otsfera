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
  | 'user'
  | 'caller'
  | 'inbound_sender';

export type PiiAction = 'list' | 'view';

export type PiiContext = {
  subjectType: PiiSubjectType;
  action: PiiAction;
  labelRu: string;
  /** Файл сервиса, обязанный вызывать recordPiiAccess с этим контекстом. */
  callSite: string;
};

export const PII_CONTEXTS = {
  manager_students_list: { subjectType: 'student', action: 'list', labelRu: 'Список слушателей', callSite: 'src/lib/services/manager/students.ts' },
  manager_student_view: { subjectType: 'student', action: 'view', labelRu: 'Карточка слушателя', callSite: 'src/lib/services/manager/students.ts' },
  manager_lead_view: { subjectType: 'lead', action: 'view', labelRu: 'Карточка лида (контакты)', callSite: 'src/lib/services/manager/leads.ts' },
  enrollments_list: { subjectType: 'enrollment_request', action: 'list', labelRu: 'Заявки на обучение', callSite: 'src/lib/services/enrollments/list.ts' },
  org_card_inbound: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Карточка организации: входящие', callSite: 'src/lib/services/manager/organizationCard.ts' },
  org_card_calls: { subjectType: 'caller', action: 'list', labelRu: 'Карточка организации: звонки', callSite: 'src/lib/services/manager/organizationCard.ts' },
  inbox_list: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Инбокс: входящие', callSite: 'src/lib/services/inbound/listInbox.ts' },
  calls_list: { subjectType: 'caller', action: 'list', labelRu: 'Журнал звонков', callSite: 'src/lib/services/telephony/listCalls.ts' },
  deal_activity_inbound: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Активность сделки: входящие', callSite: 'src/lib/services/manager/dealActivity.ts' },
  deal_activity_calls: { subjectType: 'caller', action: 'list', labelRu: 'Активность сделки: звонки', callSite: 'src/lib/services/manager/dealActivity.ts' },
  certificates_list: { subjectType: 'student', action: 'list', labelRu: 'Удостоверения', callSite: 'src/lib/services/training/certificates.ts' },
  order_items_list: { subjectType: 'student', action: 'list', labelRu: 'Слушатели заказа', callSite: 'src/lib/services/training/orderItems.ts' },
  admin_users_list: { subjectType: 'user', action: 'list', labelRu: 'Пользователи (список)', callSite: 'src/lib/services/admin/users/queries.ts' },
  admin_user_view: { subjectType: 'user', action: 'view', labelRu: 'Карточка пользователя', callSite: 'src/lib/services/admin/users/queries.ts' }
} as const satisfies Record<string, PiiContext>;

export type PiiContextKey = keyof typeof PII_CONTEXTS;
