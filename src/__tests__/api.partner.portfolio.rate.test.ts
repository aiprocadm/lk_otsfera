/**
 * У-2 / У-4 (этап 1, решение Р-4): партнёр НЕ может менять ставку комиссии.
 *
 * До этапа 1 роут пропускал партнёра-администратора (`requirePartnerAdmin`) и
 * писал `Organization.partnerCommissionRate`, а в истории
 * `OrganizationCommissionRateChange` автором значился он же. Теперь гард —
 * `requireAdmin`, роль `partner` получает `403` при любом `partnerRole`.
 *
 * Страж У-4 проверяет ОБА факта, а не только статус ответа:
 *   1) ответ `403`;
 *   2) запись в историю не создана — ни сервис `applyOrgRateOverride`, ни
 *      призма (`organization.update`, `organizationCommissionRateChange.create`,
 *      `$transaction`) не тронуты.
 *
 * Сквозная проверка на живой БД (ноль строк в истории после попытки) — в
 * `api.partner.portfolio.rate.guard.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/admin/orgRateOverride', () => ({ applyOrgRateOverride: vi.fn() }));

const prismaSpies = vi.hoisted(() => ({
  organization: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  organizationCommissionRateChange: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaSpies }));

import { getSession } from '@/lib/auth/session';
import { applyOrgRateOverride } from '@/lib/services/admin/orgRateOverride';
import { PUT } from '@/app/api/partner/portfolio/[orgId]/rate/route';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const body = (b: unknown) =>
  new Request('http://x/', {
    method: 'PUT',
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' },
  });

const ADMIN = { sub: 'admin-user', role: 'admin' } as const;

/** Ничего не записано: ни через сервис, ни в обход него — прямо в призму. */
function expectNothingWritten() {
  expect(applyOrgRateOverride).not.toHaveBeenCalled();
  expect(prismaSpies.organization.update).not.toHaveBeenCalled();
  expect(prismaSpies.organizationCommissionRateChange.create).not.toHaveBeenCalled();
  expect(prismaSpies.$transaction).not.toHaveBeenCalled();
}

describe('PUT /api/partner/portfolio/[orgId]/rate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaSpies.organization.update.mockReset();
    prismaSpies.organizationCommissionRateChange.create.mockReset();
    prismaSpies.$transaction.mockReset();
  });

  it('401 без сессии', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(401);
    expectNothingWritten();
  });

  // ── страж У-4 ────────────────────────────────────────────────────────────
  it('У-4: партнёр-администратор получает 403 и НЕ создаёт запись в истории', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'partner-admin',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'admin',
    } as never);

    const res = await PUT(body({ rate: 0.5, reason: 'сам себе' }), ctx('o1'));

    expect(res.status).toBe(403);
    expectNothingWritten();
  });

  it('У-4: обычный партнёрский пользователь получает 403 и ничего не пишет', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'partner-manager',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'manager',
    } as never);

    const res = await PUT(body({ rate: 0.5, reason: 'сам себе' }), ctx('o1'));

    expect(res.status).toBe(403);
    expectNothingWritten();
  });

  it('У-2: попытка снять ставку (rate=null) партнёром — тоже 403', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'partner-admin',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'admin',
    } as never);

    const res = await PUT(body({ rate: null, reason: 'сброс' }), ctx('o1'));

    expect(res.status).toBe(403);
    expectNothingWritten();
  });

  it('менеджер учебного центра тоже не проходит — роут админский', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'm1', role: 'manager' } as never);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(403);
    expectNothingWritten();
  });

  // ── внутренняя роль: роут остаётся рабочим (У-2) ─────────────────────────
  it('400 на кривом теле запроса (без деталей zod)', async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);

    const res = await PUT(body({}), ctx('o1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid payload' });
    expect((await PUT(body({ rate: 0.1 }), ctx('o1'))).status).toBe(400);
    expect(applyOrgRateOverride).not.toHaveBeenCalled();
  });

  it('204 админ ставит ставку — доля переводится в проценты', async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(applyOrgRateOverride).mockResolvedValue({ ok: true });

    const res = await PUT(body({ rate: 0.085, reason: 'VIP' }), ctx('o1'));

    expect(res.status).toBe(204);
    expect(applyOrgRateOverride).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      ratePercent: 8.5,
      reason: 'VIP',
      changedByUserId: 'admin-user',
    });
  });

  it('204 админ снимает ставку (rate=null → clear)', async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(applyOrgRateOverride).mockResolvedValue({ ok: true });

    const res = await PUT(body({ rate: null, reason: 'возврат к базе' }), ctx('o1'));

    expect(res.status).toBe(204);
    expect(applyOrgRateOverride).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      clear: true,
      reason: 'возврат к базе',
      changedByUserId: 'admin-user',
    });
  });

  it('404 когда организации нет (или она без партнёра)', async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(applyOrgRateOverride).mockResolvedValue({ ok: false, error: 'not_found' });

    const res = await PUT(body({ rate: 0.08, reason: 'VIP' }), ctx('o1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('422 на прочих ошибках сервиса', async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(applyOrgRateOverride).mockResolvedValue({ ok: false, error: 'rate_out_of_range' });

    const res = await PUT(body({ rate: 0.08, reason: 'VIP' }), ctx('o1'));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'rate_out_of_range' });
  });
});
