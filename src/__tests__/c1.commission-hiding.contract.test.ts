import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * C1 (§3.4/§4) — контрактный тест сокрытия комиссии в кабинете организации.
 *
 * Организация НИКОГДА не видит комиссию партнёра — даже свою «посредническую»
 * (intermediary), даже работая через партнёра. Сокрытие — на уровне API/выборки,
 * а не UI. Этот guardrail статически доказывает, что НИ ОДИН модуль кабинета
 * организации (`app/organization/**` + `app/api/organization/**`) не обращается
 * к комиссионным помощникам/моделям. Если кто-то в будущем подключит комиссию в
 * org-контур — этот тест упадёт и потребует осознанного ревью.
 *
 * Допустимо: DocumentType-литерал `commission_statement` (это ТИП документа в
 * полном enum-словаре, а не комиссионные данные — канал-изоляция всё равно не
 * отдаёт партнёрский документ организации, см. c3.idor-cross-access).
 */

const ROOT = process.cwd();
// Scan the ORG-ROLE ENTRY POINTS (pages + route handlers) — the root of the org
// cabinet's import graph and the security boundary. We deliberately do NOT scan
// `components/organization/**`: it contains `org-finance-commission.tsx`, a
// presentational component consumed by the MANAGER finance view (admin/leader,
// gated by canSeeCommission) — commission identifiers there are legitimate. A
// component is only reachable by the org role if an org page imports it, which the
// FORBIDDEN_IMPORTS check below catches.
const ORG_DIRS = [
  path.join(ROOT, 'src', 'app', 'organization'),
  path.join(ROOT, 'src', 'app', 'api', 'organization'),
];

// Идентификаторы, обозначающие КОМИССИОННЫЕ данные/логику (не document-type).
// Case-sensitive: `CommissionStatement` (модель) ≠ `commission_statement` (enum).
const FORBIDDEN_TOKENS = [
  'IntermediaryCommission', // get/canSee OrgIntermediaryCommission + тип
  'getOrgIntermediaryCommission',
  'canSeeIntermediaryCommission',
  'partnerCommissionRate', // индивидуальная ставка — внутренняя кухня
  'commissionAmount',
  'totalCommissionAmount',
  'averageRate',
  'getStatementWithItems', // партнёрские ведомости
  'getFinanceKpis', // партнёрские KPI комиссии
  'CommissionStatement', // Prisma-модель ведомости
];

// Импорт-границы: org-контур не тянет комиссионные/партнёрско-финансовые сервисы
// НИ компонент, рендерящий комиссию посредника (он живёт в components/organization,
// но предназначен для менеджерской витрины). services/organization/finance НЕ
// запрещён целиком — org-страницы законно берут оттуда getOrgFinanceKpis/
// listOrgPayments; утечку ловит запрет токена getOrgIntermediaryCommission выше.
const FORBIDDEN_IMPORTS = [
  'services/commission/',
  'services/partner/finance',
  'components/organization/org-finance-commission',
];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir may not exist in a partial checkout
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(walk(full));
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('C1 — organization cabinet never references commission', () => {
  const files = ORG_DIRS.flatMap(walk);

  it('finds organization cabinet source files to scan', () => {
    // Guard against a silently-empty scan (e.g. a moved directory making the
    // test vacuously pass).
    expect(files.length).toBeGreaterThan(0);
  });

  it('no organization-cabinet file references commission data/logic', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        if (src.includes(token)) {
          offenders.push(`${path.relative(ROOT, file)} → "${token}"`);
        }
      }
    }
    expect(
      offenders,
      `Organization cabinet must never expose partner/intermediary commission ` +
        `(C1/§3.4). Remove the reference or route it through an admin/leader-gated ` +
        `surface:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('no organization-cabinet file imports commission/partner-finance services', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const imp of FORBIDDEN_IMPORTS) {
        if (src.includes(imp)) {
          offenders.push(`${path.relative(ROOT, file)} → "${imp}"`);
        }
      }
    }
    expect(
      offenders,
      `Org cabinet must not import commission/partner-finance services:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
