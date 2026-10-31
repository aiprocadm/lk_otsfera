import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Страж совместимости миграций (`У-341`, ТЗ 28.10.2026, ДП §8).
 *
 * Версия N обязана работать со схемой N−1, а N−1 — со схемой N: иначе откат
 * релиза ломает базу. Разрушающее изменение делается в три релиза
 * (expand → migrate → contract), и contract — отдельное решение владельца.
 * Поэтому новая `migration.sql` не может молча содержать:
 *
 * - `DROP TABLE`, `DROP COLUMN`, `RENAME` (Prisma делает переименование
 *   как DROP + ADD — имя меняют через `@map`);
 * - `ALTER COLUMN … TYPE` (смена типа — через новый столбец);
 * - `SET NOT NULL` (сначала nullable и заполнение, NOT NULL — потом);
 * - `FOREIGN KEY` / `CHECK` на СУЩЕСТВУЮЩУЮ таблицу без `NOT VALID`
 *   (проверка всей таблицы под блокировкой; `VALIDATE CONSTRAINT` — отдельно).
 *   Ограничение на таблицу, созданную в той же миграции, безопасно: она пуста.
 *
 * Разрешено только с пометкой `-- contract: <ссылка на решение и релиз expand>`.
 * Применённые миграции не правятся (CLAUDE.md §2) — их нарушения зафиксированы
 * списком ниже; новый файл в список не добавляют, а ставят пометку.
 */

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');

/** Применённые до стража миграции с разрушающими изменениями (31.10.2026). */
const APPLIED_BEFORE_GUARD = new Set([
  '20260513110000_role_cabinets',
  '20260521120000_student_bridge_grant_and_fk_fix',
  '20260521150000_partner_cabinet_phase0',
  '20260522120000_phase3_lead_attachment_author_and_external_id',
  '20260525202817_order_organization_id',
  '20260526132950_order_organization_id_required',
  '20260602201317_chat_threadreadstate_user_fk',
  '20260607204237_document_counterparty',
  '20260609000000_org_level_payments_and_inn_keys',
  '20260610000000_document_order_less',
  '20260615030202_enrollment_requests',
  '20260624000000_commission_rate_history_payment_fields',
  '20260626120000_commission_item_payment',
  '20260626130000_commission_correction',
  '20260629170428_one_c_pending_record',
  '20260702130000_access_profile',
  '20260703120000_funnel_stage',
  '20260713224756_m1_deal_activity',
  '20260714185841_m2_contacts_foundation',
  '20260723230000_stage2_enrollment_items',
  '20260724203408_stage5_client_requests',
  '20260725142609_stage6_deals_kanban',
  '20260725164309_stage6_pr2_dealnote_parallel',
  '20260726060832_stage7_pr1_task_links_due_soon',
  '20260726074352_stage7_pr2_intake_sources_claims',
  '20260727230000_stage12_order_result_delivery',
  '20260729160000_stage2_order_status_registry',
  '20260730080000_stage2_drop_order_status_enum',
  '20260810100000_stage6_item_direction',
  '20260810180000_stage6_item_direction_required',
  '20260818150000_leader_role_contract',
  '20260819180000_u36_drop_request_direction',
  '20260827140000_stage5_drop_order_item_amount',
  '20260827160000_stage6_document_lines_status',
  '20260831160000_stage6_numbering_constraints',
  '20260831170000_stage6_numbering_fk_ondelete',
  '20260901100000_stage7_proposal_model',
  '20260901110000_stage7_proposal_lead_restrict',
  '20260903100000_stage8_document_push_model',
  '20260913090000_stage1_contacts_notes',
  '20260913140000_stage2_bitrix_batches',
  '20260914120000_stage3_dialog_assignee_status',
  '20260915120000_stage3_website_request',
  '20260916100000_stage4_task_links',
  '20260916110000_stage4_automation_rules',
  '20260916140000_stage4_task_recurrence',
  '20260917220000_stage6_request_reply_partner_manager',
  '20260918130000_stage9_drop_dead_tables',
  '20261014120000_pm_stage2_student_cabinet',
]);

const RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { name: 'RENAME', re: /\bRENAME\b/i },
  { name: 'ALTER COLUMN … TYPE', re: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i },
  { name: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
];

/** Нарушения правила совместимости в тексте одной миграции. */
function violations(raw: string): string[] {
  if (/^\s*--\s*contract:\s*\S+/im.test(raw)) return [];
  const sql = raw.replace(/--[^\n]*/g, '');
  const created = new Set(
    [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)].map((m) => m[1])
  );
  const found = RULES.filter((r) => r.re.test(sql)).map((r) => r.name);
  for (const statement of sql.split(';')) {
    const m =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?"([^"]+)"\s+ADD\s+CONSTRAINT\b[\s\S]*\b(FOREIGN\s+KEY|CHECK)\b/i.exec(
        statement
      );
    if (m && !created.has(m[1]!) && !/\bNOT\s+VALID\b/i.test(statement)) {
      found.push('ограничение без NOT VALID');
      break;
    }
  }
  return found;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS).filter((n) => statSync(join(MIGRATIONS, n)).isDirectory());
}

describe('миграции совместимы с предыдущим релизом (У-341)', () => {
  it('новая миграция без пометки `-- contract:` ничего не разрушает', () => {
    const offenders: string[] = [];
    for (const name of migrationNames()) {
      if (APPLIED_BEFORE_GUARD.has(name)) continue;
      const found = violations(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
      if (found.length) offenders.push(`${name}: ${found.join(', ')}`);
    }
    expect(
      offenders,
      'Разрушающее изменение — только по трём фазам (ДП §8, CLAUDE.md §2b): ' +
        'сделайте аддитивно или поставьте `-- contract: <решение владельца>`.\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('список исключений — только реально существующие применённые миграции', () => {
    const existing = new Set(migrationNames());
    const stale = [...APPLIED_BEFORE_GUARD].filter((n) => !existing.has(n));
    expect(stale).toEqual([]);
    // Список заморожен: появись в нём новый файл — значит, его вписали, чтобы
    // обойти стража. Самая поздняя запись — до введения стража.
    const latest = [...APPLIED_BEFORE_GUARD].sort().at(-1)!;
    expect(latest < '20261031000000').toBe(true);
  });
});

describe('распознавание разрушающих изменений', () => {
  it.each([
    ['DROP TABLE "Old";', 'DROP TABLE'],
    ['ALTER TABLE "A" DROP COLUMN "x";', 'DROP COLUMN'],
    ['ALTER TABLE "A" RENAME COLUMN "x" TO "y";', 'RENAME'],
    ['ALTER TABLE "A" ALTER COLUMN "x" TYPE INTEGER;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "A" ALTER COLUMN "x" SET DATA TYPE TEXT;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;', 'SET NOT NULL'],
    [
      'ALTER TABLE "A" ADD CONSTRAINT "A_b_fkey" FOREIGN KEY ("b") REFERENCES "B"("id");',
      'ограничение без NOT VALID',
    ],
    ['ALTER TABLE "A" ADD CONSTRAINT "c" CHECK ("x" > 0);', 'ограничение без NOT VALID'],
  ])('%s → %s', (sql, rule) => {
    expect(violations(sql)).toContain(rule);
  });

  it.each([
    ['аддитивный столбец', 'ALTER TABLE "A" ADD COLUMN "x" TEXT;'],
    [
      'внешний ключ с NOT VALID',
      'ALTER TABLE "A" ADD CONSTRAINT "f" FOREIGN KEY ("b") REFERENCES "B"("id") NOT VALID;',
    ],
    [
      'внешний ключ на таблицу из той же миграции',
      'CREATE TABLE "N" ("id" TEXT);\nALTER TABLE "N" ADD CONSTRAINT "f" FOREIGN KEY ("id") REFERENCES "B"("id");',
    ],
    ['слово в комментарии', '-- раньше тут был DROP COLUMN\nALTER TABLE "A" ADD COLUMN "x" TEXT;'],
    [
      'пометка contract',
      '-- contract: решение владельца 2026-12-01, expand в 0.13.0\nALTER TABLE "A" DROP COLUMN "x";',
    ],
  ])('%s — не нарушение', (_label, sql) => {
    expect(violations(sql)).toEqual([]);
  });
});
