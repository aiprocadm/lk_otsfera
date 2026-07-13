// src/__tests__/pii.contexts.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PII_CONTEXTS } from '@/lib/pii/contexts';

const SUBJECT_TYPES = new Set([
  'student', 'lead', 'enrollment_request', 'user', 'caller', 'inbound_sender'
]);

describe('PII_CONTEXTS registry', () => {
  const entries = Object.entries(PII_CONTEXTS);

  it('содержит все 14 контекстов v1+M1', () => {
    expect(entries.map(([k]) => k).sort()).toEqual([
      'admin_user_view', 'admin_users_list', 'calls_list', 'certificates_list',
      'deal_activity_calls', 'deal_activity_inbound',
      'enrollments_list', 'inbox_list', 'manager_lead_view',
      'manager_student_view', 'manager_students_list', 'order_items_list',
      'org_card_calls', 'org_card_inbound'
    ]);
  });

  it.each(entries)('%s: валидные subjectType/action/labelRu/callSite', (_key, ctx) => {
    expect(SUBJECT_TYPES.has(ctx.subjectType)).toBe(true);
    expect(['list', 'view']).toContain(ctx.action);
    expect(ctx.labelRu.length).toBeGreaterThan(0);
    expect(existsSync(path.join(process.cwd(), ctx.callSite))).toBe(true);
  });
});
