import { describe, it, expect } from 'vitest';
import { auditActionRu } from '@/lib/i18n/auditActions';

describe('auditActionRu', () => {
  it('переводит все TRACKED_ACTIONS админ-дашборда', () => {
    expect(auditActionRu('commission_statement_approved')).toBe('утвердил отчёт по комиссии');
    expect(auditActionRu('lead_created')).toBe('создал заявку');
    expect(auditActionRu('user_role_changed')).toBe('изменил роль пользователя');
    expect(auditActionRu('partner_created')).toBe('создал партнёра');
  });
  it('неизвестный код — подчёркивания в пробелы, не падает', () => {
    expect(auditActionRu('some_new_action')).toBe('some new action');
  });
});
