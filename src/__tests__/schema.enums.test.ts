import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(__dirname, '../../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf-8');

function enumValues(name: string): string[] {
  const match = schema.match(new RegExp(`enum\\s+${name}\\s*\\{([^}]+)\\}`));
  if (!match) {
    throw new Error(`enum ${name} not found in schema.prisma`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

describe('Schema enums (parsed from prisma/schema.prisma)', () => {
  it('ExecutionStatus includes pending/in_progress/completed/cancelled/on_hold', () => {
    expect(enumValues('ExecutionStatus')).toEqual(
      expect.arrayContaining(['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
    );
  });

  it('FinancialStatus includes not_billed..refunded', () => {
    expect(enumValues('FinancialStatus')).toEqual(
      expect.arrayContaining(['not_billed', 'billed', 'partially_paid', 'paid', 'refunded'])
    );
  });

  it('DocumentType covers all required document kinds', () => {
    expect(enumValues('DocumentType')).toEqual(
      expect.arrayContaining([
        'contract', 'extra_agreement', 'invoice', 'act', 'waybill',
        'certificate', 'report', 'commission_statement', 'other'
      ])
    );
  });

  it('DocumentDirection has incoming and outgoing', () => {
    expect(enumValues('DocumentDirection')).toEqual(
      expect.arrayContaining(['incoming', 'outgoing'])
    );
  });

  it('GenerationSource has user and system', () => {
    expect(enumValues('GenerationSource')).toEqual(
      expect.arrayContaining(['user', 'system'])
    );
  });

  // Этап 11 PR-3 (ФТ-15.7): enum NotificationType удалён из схемы. Он был
  // мёртвым — `Notification.type` всегда был String, enum не был связан ни с
  // одной колонкой и не упоминался в коде, а его состав давно разошёлся с
  // реальностью (19+ реальных типов против 8 в enum). Источник правды —
  // реестр src/lib/notifications/registry.ts (см. notifications.registry.*).
  it('NotificationType больше не объявлен в схеме', () => {
    expect(() => enumValues('NotificationType')).toThrow(/not found/);
  });

  it('LeadStatus has full lifecycle', () => {
    expect(enumValues('LeadStatus')).toEqual(
      expect.arrayContaining(['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'])
    );
  });

  it('CommissionStatementStatus has draft..superseded', () => {
    expect(enumValues('CommissionStatementStatus')).toEqual(
      expect.arrayContaining(['draft', 'approved', 'paid', 'superseded'])
    );
  });
});
