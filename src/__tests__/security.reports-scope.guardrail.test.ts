import { describe, it, expect, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { PrismaClient } from '@prisma/client';
import { REPORTS, canRunReport, reportByKey } from '@/lib/reports/registry';

/**
 * СТРАЖ `У-249` (этап 7): кому какие отчёты доступны.
 *
 * Рядовой менеджер отчёты руководителя **не выгружает** — это «нет», а не
 * «пусто»: пустой файл человек принял бы за «данных нет». Партнёр видит только
 * свои начисления. Право `see_commission` соблюдается: без него суммы не
 * показываются.
 *
 * Мутация (проверено): разрешить менеджеру отчёты руководителя в `canRunReport`
 * → «рядовой менеджер не выгружает» краснеет; убрать фильтр по своему партнёру
 * → «партнёр видит только себя» краснеет; снять проверку `see_commission`
 * → «без права суммы не показываются» краснеет.
 */
const ADMIN = { sub: 'a1', role: 'admin', companyId: 'c1' } as unknown as SessionPayload;
const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;
const PARTNER = { sub: 'p1', role: 'partner', partnerId: 'p-own' } as unknown as SessionPayload;
const ORG = { sub: 'o1', role: 'organization' } as unknown as SessionPayload;

vi.mock('@/lib/services/leader/partnersAnalytics', () => ({
  getPartnersAnalytics: vi.fn(async () => ({
    rows: [
      {
        partnerId: 'p-own',
        partnerName: 'Свой',
        organizations: 1,
        accrued: '100.00',
        paid: '50.00',
        requests: 2,
      },
      {
        partnerId: 'p-other',
        partnerName: 'Чужой',
        organizations: 3,
        accrued: '900.00',
        paid: '900.00',
        requests: 7,
      },
    ],
    totalAccrued: '1000.00',
    totalPaid: '950.00',
  })),
}));

const ctx = (session: SessionPayload) => ({
  prisma: {} as unknown as PrismaClient,
  session,
  companyId: 'c1',
  year: 2026,
  month: 9,
  olderThanDays: 0,
});

describe('страж: права на отчёты (У-249)', () => {
  it('руководитель и администратор выгружают все отчёты', () => {
    for (const r of REPORTS) {
      expect(canRunReport(r, LEADER), `${r.key}: руководителю отказано`).toBe(true);
      expect(canRunReport(r, ADMIN), `${r.key}: администратору отказано`).toBe(true);
    }
  });

  it('рядовой менеджер не выгружает НИ ОДНОГО отчёта руководителя', () => {
    for (const r of REPORTS) {
      expect(canRunReport(r, MANAGER), `${r.key}: менеджер получил доступ`).toBe(false);
    }
  });

  it('партнёру доступны только начисления, и только они', () => {
    const allowed = REPORTS.filter((r) => canRunReport(r, PARTNER)).map((r) => r.key);
    expect(allowed).toEqual(['partner_accruals']);
  });

  it('заказчику не доступно ничего', () => {
    for (const r of REPORTS) {
      expect(canRunReport(r, ORG), `${r.key}: заказчик получил доступ`).toBe(false);
    }
  });

  it('партнёр видит в начислениях только СВОИ строки', async () => {
    const rows = await reportByKey('partner_accruals').rows(ctx(PARTNER));
    expect(rows.map((r) => r.partner)).toEqual(['Свой']);
  });

  it('партнёр без идентификатора не видит ничего — это не «видит всё»', async () => {
    const nameless = { sub: 'p2', role: 'partner' } as unknown as SessionPayload;
    const rows = await reportByKey('partner_accruals').rows(ctx(nameless));
    expect(rows).toEqual([]);
  });

  it('руководитель видит строки всех партнёров компании', async () => {
    const rows = await reportByKey('partner_accruals').rows(ctx(LEADER));
    expect(rows.map((r) => r.partner)).toEqual(['Свой', 'Чужой']);
    expect(rows[0]!.accrued).toBe(100);
  });

  it('без права «видеть комиссию» суммы не показываются', async () => {
    // Профиль менеджера без `see_commission`: строки видны, деньги — нет.
    const rows = await reportByKey('partner_accruals').rows(ctx(MANAGER));
    expect(rows[0]!.accrued).toBe('нет доступа');
    expect(rows[0]!.paid).toBe('нет доступа');
    // Название партнёра и число обращений — не деньги, они остаются.
    expect(rows[0]!.partner).toBe('Свой');
  });
});
