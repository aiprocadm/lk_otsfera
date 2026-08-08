import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Добор покрытия по партнёрским API-роутам (группа «partner-api»):
 *  - `POST /api/partner/finance/statements` — ветка «период пустой строкой»
 *    (zod `z.string()` пропускает `''`, дальше срабатывает доменная проверка);
 *  - `POST /api/partner/team` — ветка «у приглашающего есть имя»
 *    (условный спред `invitedByName` под exactOptionalPropertyTypes).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
const { calculateStatementForPartner } = vi.hoisted(() => ({
  calculateStatementForPartner: vi.fn(),
}));
const { listTeam, inviteMember, getPartnerName } = vi.hoisted(() => ({
  listTeam: vi.fn(),
  inviteMember: vi.fn(),
  getPartnerName: vi.fn(),
}));
const { sendPartnerInviteEmail } = vi.hoisted(() => ({ sendPartnerInviteEmail: vi.fn() }));
const { auditCreate } = vi.hoisted(() => ({ auditCreate: vi.fn() }));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/services/commission/statement', () => ({ calculateStatementForPartner }));
vi.mock('@/lib/services/partner/team', () => ({ listTeam, inviteMember, getPartnerName }));
vi.mock('@/lib/email/send', () => ({ sendPartnerInviteEmail }));
vi.mock('@/lib/logging', () => ({
  log: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { auditLog: { create: auditCreate } } }));

import { POST as POST_STATEMENT } from '@/app/api/partner/finance/statements/route';
import { POST as POST_TEAM } from '@/app/api/partner/team/route';

const partnerAdminSession = {
  sub: 'u-admin',
  role: 'partner',
  partnerId: 'p1',
  partnerRole: 'admin',
  assignedOrgIds: [],
} as any;

function jsonReq(body: unknown) {
  return new Request('http://x/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/partner/finance/statements — пустая строка вместо даты', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditCreate.mockResolvedValue(undefined);
  });

  it('periodFrom = "" → 400 «periodFrom and periodTo are required», сервис не зовётся', async () => {
    getSession.mockResolvedValue(partnerAdminSession);

    const res = await POST_STATEMENT(jsonReq({ periodFrom: '', periodTo: '2026-04-30' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'periodFrom and periodTo are required' });
    // Пустая строка отсекается ДО расчёта — иначе new Date('') дал бы Invalid Date.
    expect(calculateStatementForPartner).not.toHaveBeenCalled();
  });

  it('periodTo = "" → тот же 400 (правая половина проверки), сервис не зовётся', async () => {
    getSession.mockResolvedValue(partnerAdminSession);

    const res = await POST_STATEMENT(jsonReq({ periodFrom: '2026-04-01', periodTo: '' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'periodFrom and periodTo are required' });
    expect(calculateStatementForPartner).not.toHaveBeenCalled();
  });
});

describe('POST /api/partner/team — имя приглашающего попадает в письмо', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditCreate.mockResolvedValue(undefined);
  });

  it('у сессии есть name → письмо уходит с invitedByName', async () => {
    getSession.mockResolvedValue({ ...partnerAdminSession, name: 'Иван Петров' });
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u1' },
      partnerUser: { id: 'pu1' },
      inviteUrl: 'https://app/reset-password?token=t9',
    });
    getPartnerName.mockResolvedValue('ООО Партнёр');
    sendPartnerInviteEmail.mockResolvedValue({ status: 'sent', id: 'em-9' });

    const res = await POST_TEAM(
      jsonReq({ email: 'x@x.local', name: 'Новичок', roleInPartner: 'manager', assignedOrgIds: [] })
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ emailStatus: 'sent' });
    const [payload] = sendPartnerInviteEmail.mock.calls[0];
    expect(payload.invitedByName).toBe('Иван Петров');
    // Ключ реально присутствует (условный спред сработал по «истинной» ветке).
    expect(Object.keys(payload)).toContain('invitedByName');
  });
});
