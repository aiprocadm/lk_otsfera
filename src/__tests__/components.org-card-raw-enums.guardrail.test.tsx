import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DocumentDirection, DocumentType, ExecutionStatus, FinancialStatus } from '@prisma/client';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { orgCardTabsFor } from '@/lib/navigation/orgCardTabs';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

/**
 * Страж `У-328` (`Д-62`, ТЗ 28.10.2026): в таблицах карточки организации
 * статусы заказа, тип и направление документа выводились сырыми значениями
 * базы — «pending», «not_billed», «invoice», «incoming». Карточку рисует один
 * компонент во всех кабинетах (и в «Моей организации» заказчика), поэтому
 * страж прогоняет через него ВСЕ значения перечислений: новое значение без
 * подписи покажется здесь английским словом и уронит тест.
 */

const TABS = orgCardTabsFor('manager', { flags: () => true });

function card(overrides: Partial<OrganizationCard>): OrganizationCard {
  return {
    name: 'ООО Ромашка',
    partner: null,
    inn: '1234567890',
    kpp: null,
    commission: null,
    counts: { orders: 0, students: 0, cabinetUsers: 0, contacts: 0 },
    kpis: { activeOrders: 0, totalPaid: '0.00', debt: '0.00' },
    tabTotals: {},
    orders: [],
    documents: [],
    payments: [],
    activity: [],
    inboundMessages: [],
    calls: [],
    requisites: {},
    ...overrides,
  } as unknown as OrganizationCard;
}

/** Код перечисления, стоящий в ячейке таблицы целиком: `>pending<`. */
function rawCells(html: string, codes: string[]): string[] {
  return codes.filter((code) => new RegExp(`>\\s*${code}\\s*<`).test(html));
}

describe('Карточка организации: ни одно значение перечисления не выводится сырым (У-328)', () => {
  it('вкладка «Заказы»: статусы исполнения и оплаты — по-русски', () => {
    const execution = Object.values(ExecutionStatus);
    const financial = Object.values(FinancialStatus);
    const orders = execution.flatMap((e, i) =>
      financial.map((f, j) => ({
        id: `o-${i}-${j}`,
        orderNumber: `2410-${i}${j}`,
        title: 'Курс ОТ',
        executionStatus: e,
        financialStatus: f,
        totalAmount: '1000.00',
        paidAmount: '0.00',
      }))
    );
    const html = renderToString(
      React.createElement(OrgCardTabs, {
        card: card({ orders } as Partial<OrganizationCard>),
        activeTab: 'orders',
        tabs: TABS,
      })
    );
    expect(rawCells(html, [...execution, ...financial])).toEqual([]);
    expect(html).toContain('Ожидает старта');
    expect(html).toContain('Счёт не выставлен');
  });

  it('вкладка «Документы»: тип и направление — по-русски', () => {
    const types = Object.values(DocumentType);
    const directions = Object.values(DocumentDirection);
    const documents = types.flatMap((t, i) =>
      directions.map((d, j) => ({
        id: `d-${i}-${j}`,
        name: `Документ ${i}-${j}`,
        type: t,
        direction: d,
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
      }))
    );
    const html = renderToString(
      React.createElement(OrgCardTabs, {
        card: card({ documents } as Partial<OrganizationCard>),
        activeTab: 'documents',
        tabs: TABS,
      })
    );
    expect(rawCells(html, [...types, ...directions])).toEqual([]);
    expect(html).toContain('Счёт');
    expect(html).toContain('Входящий');
  });
});
