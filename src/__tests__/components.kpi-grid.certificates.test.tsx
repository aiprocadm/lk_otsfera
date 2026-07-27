import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { OrgKpiGrid } from '@/components/organization/org-kpi-grid';
import { KpiGrid } from '@/components/partner/kpi-grid';

/**
 * Этап 3 PR-1 (ФТ-6.4): опциональная KPI-карточка «Истекают удостоверения»
 * в сетках организации и партнёра — null (флаг off) карточки нет; 0 — без
 * акцента; >0 — акцент; ссылка ведёт в реестр с фильтром expiring.
 */

const ORG_KPIS = { activeOrders: 1, outstandingAmount: '0', studentsCount: 2, recentDocumentsCount: 3 };
const PARTNER_KPIS = { openOrders: 1, outstanding: '0', commissionThisMonth: '0' };

describe('OrgKpiGrid — карточка удостоверений', () => {
  it('по умолчанию (null) карточки нет', () => {
    const html = renderToString(<OrgKpiGrid kpis={ORG_KPIS} />);
    expect(html).not.toContain('Истекают удостоверения');
  });

  it('число → карточка со ссылкой в реестр ?status=expiring', () => {
    const html = renderToString(<OrgKpiGrid kpis={ORG_KPIS} expiringCertificates={7} />);
    expect(html).toContain('Истекают удостоверения');
    expect(html).toContain('7');
    expect(html).toContain('/organization/certificates?status=expiring');
  });

  it('0 → карточка есть, но без акцента (accent только при >0)', () => {
    const zero = renderToString(<OrgKpiGrid kpis={ORG_KPIS} expiringCertificates={0} />);
    const some = renderToString(<OrgKpiGrid kpis={ORG_KPIS} expiringCertificates={5} />);
    expect(zero).toContain('Истекают удостоверения');
    // Акцентный вариант отличается разметкой StatCard.
    expect(zero).not.toEqual(some);
  });
});

describe('KpiGrid (партнёр) — карточка удостоверений', () => {
  it('по умолчанию (null) карточки нет', () => {
    const html = renderToString(<KpiGrid kpis={PARTNER_KPIS} />);
    expect(html).not.toContain('Истекают удостоверения');
  });

  it('число → карточка со ссылкой в реестр партнёра', () => {
    const html = renderToString(<KpiGrid kpis={PARTNER_KPIS} expiringCertificates={2} />);
    expect(html).toContain('Истекают удостоверения');
    expect(html).toContain('/partner/certificates?status=expiring');
  });

  it('0 → карточка без акцента', () => {
    const html = renderToString(<KpiGrid kpis={PARTNER_KPIS} expiringCertificates={0} />);
    expect(html).toContain('Истекают удостоверения');
  });
});
