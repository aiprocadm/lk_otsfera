import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Track E / E2-D — named security-suite manifest.
 *
 * The security invariants live across several files (Track C/F/E). This manifest
 * is the single named entry point: it fails if any invariant file is deleted or
 * renamed, and — critically — asserts every DB-backed invariant is integration-tier
 * (`new PrismaClient(`), which is exactly the condition Vitest uses to include a
 * file in `test:integration` / `npm run gate`. So the whole set is guaranteed to
 * run in the gate with no CI wiring.
 */

const TESTS = path.join(process.cwd(), 'src', '__tests__');
const PRISMA_MARKER = 'new PrismaClient(';

// Static/mock-level guardrails — run in the unit tier (pre-push) and the full run.
const STATIC_GUARDRAILS = [
  'c1.commission-hiding.contract.test.ts', // org cabinet source never references commission
  'c2.multirole-commission.test.ts', // org-context session → partner commission endpoints 403
  'security.redirect.test.ts', // student bridge redirect URL allowlist
  // Этап 10 (ТЗ §3.2/§7): домен лидов не возвращается в клиентские кабинеты,
  // запрещённые §7 поля не просачиваются в клиентские сервисы.
  'security.client-visibility.guardrail.test.ts'
];

// DB-backed invariants — MUST be integration-tier so `gate` runs them.
const INTEGRATION_INVARIANTS = [
  'c3.idor-cross-access.test.ts', // Order / Document / Payment / CommissionStatement IDOR
  'f.list-cross-tenant.test.ts', // manager company-scope on list services
  'f4.org-rate-history.test.ts', // per-org commission rate history
  'security.idor-comments.integration.test.ts', // partner comments cross-tenant (E2-C)
  // Этап 10 PR-2: негативные тесты матрицы §7 ТЗ (сделки, DealNote, Intake,
  // связь заявки с лидом, cross-tenant обращений).
  'security.client-visibility.integration.test.ts',
  'security.partner-commission-idor.integration.test.ts', // partner↔partner commission IDOR (E2-B)
  // Новые домены (R0.7 release hardening): инварианты изоляции под защитой манифеста.
  'security.idor-calls.integration.test.ts', // telephony: listCalls C8 + recording IDOR
  'security.idor-inbox.integration.test.ts', // inbound inbox: C8 list + bind/reply cross-company
  'services.tasks.isolation.test.ts', // internal tasks: клиентские роли + cross-company deny
  'services.funnel.isolation.test.ts' // sales funnel: staff-гейт (клиентские роли deny)
];

function read(file: string): string {
  return readFileSync(path.join(TESTS, file), 'utf8');
}

describe('E2-D — security suite manifest', () => {
  it('every security-invariant file exists (guards against silent deletion/rename)', () => {
    const missing = [...STATIC_GUARDRAILS, ...INTEGRATION_INVARIANTS].filter(
      (f) => !existsSync(path.join(TESTS, f))
    );
    expect(missing, `Missing security-invariant files:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every DB-backed invariant is integration-tier (→ runs in gate)', () => {
    const notIntegration = INTEGRATION_INVARIANTS.filter((f) => !read(f).includes(PRISMA_MARKER));
    expect(
      notIntegration,
      `These must contain "${PRISMA_MARKER}" to be included in test:integration/gate:\n  ${notIntegration.join('\n  ')}`
    ).toEqual([]);
  });

  it('static guardrails stay in the unit tier (no live DB)', () => {
    const unexpectedIntegration = STATIC_GUARDRAILS.filter((f) => read(f).includes(PRISMA_MARKER));
    expect(unexpectedIntegration, `Unexpected PrismaClient in static guardrails:\n  ${unexpectedIntegration.join('\n  ')}`).toEqual([]);
  });
});
