import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * `У-99`: вкладка «Настройки» карточки организации в кабинетах сотрудников ЦО.
 * Проверяем разницу прав, а не внешний вид: форму правки ставки получает
 * руководитель и не получает рядовой менеджер, а назначать менеджеров нельзя
 * ни тому, ни другому — ТЗ расширило права только по ставке.
 */
const { listOrgRateHistory } = vi.hoisted(() => ({ listOrgRateHistory: vi.fn() }));
vi.mock('@/lib/services/commission/rateHistory', () => ({ listOrgRateHistory }));

vi.mock('@/components/partner/customer-access-section', () => ({
  CustomerAccessSection: (p: { canInvite: boolean }) =>
    React.createElement('div', null, `ДОСТУП canInvite:${String(p.canInvite)}`),
}));
vi.mock('@/components/admin/managers-block', () => ({
  ManagersBlock: (p: { canManage?: boolean }) =>
    React.createElement('div', null, `МЕНЕДЖЕРЫ canManage:${String(p.canManage)}`),
}));
vi.mock('@/components/admin/admin-rate-override-form', () => ({
  AdminRateOverrideForm: () => React.createElement('div', null, 'ФОРМА СТАВКИ'),
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: (p: { entityId: string }) =>
    React.createElement('div', null, `ПОЛЯ ${p.entityId}`),
}));

import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { OrgStaffSettings } from '@/components/organization/org-staff-settings';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

const prisma = {} as PrismaClient;

function card(over: Partial<OrganizationCard> = {}): OrganizationCard {
  return {
    id: 'org-1',
    name: 'ООО Ромашка',
    inn: '7707083893',
    kpp: null,
    requisites: {
      legalName: 'ООО «Ромашка»',
      ogrn: null,
      legalAddress: null,
      bankName: null,
      bankAccount: null,
      corrAccount: null,
      bic: null,
      signerName: null,
      signerPosition: null,
      signerBasis: null,
    },
    partner: null,
    counts: { orders: 0, students: 0, cabinetUsers: 0 },
    kpis: { activeOrders: 0, totalPaid: '0', totalRefunded: '0', debt: '0' },
    orders: [],
    documents: [],
    payments: [],
    activity: [],
    inboundMessages: [],
    calls: [],
    clientRequests: [],
    leads: [],
    deals: [],
    certificates: [],
    commission: { partnerCommissionRate: '0.0800', note: 'VIP' },
    ...over,
  } as OrganizationCard;
}

const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-1' } as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'co-1' } as SessionPayload;

async function render(node: Promise<React.ReactElement>): Promise<string> {
  return renderToString(await node);
}

describe('OrgStaffSettings (У-99)', () => {
  beforeEach(() => {
    listOrgRateHistory.mockReset();
    listOrgRateHistory.mockResolvedValue({ ok: true, rows: [] });
  });

  it('руководитель получает форму правки ставки', async () => {
    const html = await render(
      OrgStaffSettings({
        cabinet: 'leader',
        card: card(),
        session: LEADER,
        prisma,
        customFields: [],
      }) as Promise<React.ReactElement>
    );
    expect(html).toContain('ФОРМА СТАВКИ');
    expect(html).toMatch(/8\s*%/);
    expect(html).toContain('VIP');
  });

  it('рядовой менеджер ставку видит, но править не может', async () => {
    listOrgRateHistory.mockResolvedValue({ ok: false, error: 'forbidden' });
    const html = await render(
      OrgStaffSettings({
        cabinet: 'manager',
        card: card(),
        session: MANAGER,
        prisma,
        customFields: [],
      }) as Promise<React.ReactElement>
    );
    expect(html).toContain('Ставка комиссии');
    expect(html).not.toContain('ФОРМА СТАВКИ');
  });

  it('приглашать в кабинет и назначать менеджеров со вкладки нельзя ни менеджеру, ни руководителю', async () => {
    const html = await render(
      OrgStaffSettings({
        cabinet: 'leader',
        card: card(),
        session: LEADER,
        prisma,
        customFields: [],
      }) as Promise<React.ReactElement>
    );
    expect(html).toContain('ДОСТУП canInvite:false');
    expect(html).toContain('МЕНЕДЖЕРЫ canManage:false');
  });

  it('без права видеть комиссию секции ставки нет вовсе', async () => {
    const html = await render(
      OrgStaffSettings({
        cabinet: 'manager',
        card: card({ commission: null }),
        session: MANAGER,
        prisma,
        customFields: [],
      }) as Promise<React.ReactElement>
    );
    expect(html).not.toContain('Ставка комиссии');
    // Остальные секции на месте — вкладка не «схлопывается».
    expect(html).toContain('Реквизиты');
    expect(html).toContain('Доступ в кабинет');
    expect(html).toContain('Дополнительные поля');
  });

  it('ставки нет — секция говорит про базовую ставку партнёра', async () => {
    const html = await render(
      OrgStaffSettings({
        cabinet: 'leader',
        card: card({ commission: { partnerCommissionRate: null, note: null } }),
        session: LEADER,
        prisma,
        customFields: [],
      }) as Promise<React.ReactElement>
    );
    expect(html).toContain('Индивидуальной ставки нет');
  });
});
