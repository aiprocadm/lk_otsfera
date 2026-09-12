// src/__tests__/pii.contexts.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PII_CONTEXTS } from '@/lib/pii/contexts';

const SUBJECT_TYPES = new Set([
  'student',
  'lead',
  'enrollment_request',
  'client_request',
  'user',
  'caller',
  'inbound_sender',
  'contact', // этап 1 ТЗ 12.09.2026 (`У-186`): контакт — физлицо клиентского контура
]);

describe('PII_CONTEXTS registry', () => {
  const entries = Object.entries(PII_CONTEXTS);

  it('содержит все 29 контекстов v1+M1+M6+этапы 2/5/7/9 + ТЗ кабинетов + мессенджеры + контакты', () => {
    expect(entries.map(([k]) => k).sort()).toEqual([
      'admin_user_view',
      'admin_users_list',
      'calls_list',
      'certificates_list',
      'client_request_view', // этап 5: деталка обращения клиента
      'client_requests_list', // этап 5: очередь/списки обращений
      'contact_card', // этап 1 ТЗ 12.09.2026 (`У-186`): карточка контакта
      'contacts_list', // этап 1 ТЗ 12.09.2026 (`У-186`): список контактов
      'deal_activity_calls',
      'deal_activity_inbound',
      'enrollment_detail', // этап 2 PR-2: деталка заявки подателя
      'enrollment_wizard_students', // этап 2: чекбоксы слушателей в мастере заявки
      'enrollments_list',
      'global_search_students',
      'inbox_list',
      'intake_list', // этап 7: union-список «Входящие в работу»
      'manager_lead_view',
      'manager_student_view',
      'manager_students_list',
      'messengers_candidates', // спека 2026-09-12: кому написать первым (пользователи + контакты)
      'messengers_list', // спека 2026-09-12: список диалогов
      'messengers_view', // спека 2026-09-12: карточка диалога
      'order_items_list',
      'org_card_calls',
      'org_card_certificates_export', // этап 9 PR-3: выгрузка удостоверений из карточки
      'org_card_employee_view', // `У-97`: карточка сотрудника внутри карточки организации
      'org_card_inbound',
      'proposal_issue_lead', // этап 7 `У-161`: имя контакта лида печатается в КП
    ]);
  });

  it.each(entries)('%s: валидные subjectType/action/labelRu/callSite', (_key, ctx) => {
    expect(SUBJECT_TYPES.has(ctx.subjectType)).toBe(true);
    expect(['list', 'view', 'export']).toContain(ctx.action);
    expect(ctx.labelRu.length).toBeGreaterThan(0);
    expect(existsSync(path.join(process.cwd(), ctx.callSite))).toBe(true);
  });
});
