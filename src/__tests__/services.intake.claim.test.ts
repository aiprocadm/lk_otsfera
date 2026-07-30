/**
 * Этап 7 (ФТ-8.2) — claim-сервисы Intake: гейт/скоуп до мутации,
 * already_assigned, идемпотентность, lifecycle, аудит. Prisma-фейки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { claimEnrollment, claimInbound, claimCall, closeCallIntake } from '@/lib/services/intake/claim';

const manager = (over: Record<string, unknown> = {}): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A', ...over } as unknown as SessionPayload);
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' } as unknown as SessionPayload);

function fake(model: string, row: unknown) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: { [model]: { findUnique, update } } as unknown as PrismaClient,
    findUnique,
    update
  };
}

beforeEach(() => recordAuditMock.mockReset());

describe('claimEnrollment', () => {
  const ROW = { id: 'e1', status: 'pending', claimedByUserId: null };

  it('клиентская роль → forbidden (без чтения БД)', async () => {
    const { prisma, findUnique } = fake('enrollmentRequest', ROW);
    expect(await claimEnrollment(prisma, partner(), { id: 'e1' })).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('успех: пишет claimed-поля + аудит', async () => {
    const { prisma, update } = fake('enrollmentRequest', ROW);
    expect(await claimEnrollment(prisma, manager(), { id: 'e1' })).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ claimedByUserId: 'm1' }) })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'intake_claimed', entity: 'enrollment_request' }));
  });

  it('not_found / не-pending / чужой claim / повторный свой', async () => {
    expect(await claimEnrollment(fake('enrollmentRequest', null).prisma, manager(), { id: 'x' })).toEqual({ ok: false, error: 'not_found' });
    expect(await claimEnrollment(fake('enrollmentRequest', { ...ROW, status: 'approved' }).prisma, manager(), { id: 'e1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(await claimEnrollment(fake('enrollmentRequest', { ...ROW, claimedByUserId: 'm2' }).prisma, manager(), { id: 'e1' })).toEqual({ ok: false, error: 'already_assigned' });
    const own = fake('enrollmentRequest', { ...ROW, claimedByUserId: 'm1' });
    expect(await claimEnrollment(own.prisma, manager(), { id: 'e1' })).toEqual({ ok: true, changed: false });
    expect(own.update).not.toHaveBeenCalled();
  });
});

describe('claimInbound', () => {
  const ROW = { id: 'i1', status: 'unresolved', companyId: null, claimedByUserId: null };

  it('успех по общей очереди (companyId=null) + аудит', async () => {
    const { prisma, update } = fake('inboundMessage', ROW);
    expect(await claimInbound(prisma, manager(), { id: 'i1' })).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalled();
  });

  it('чужая компания при не-unresolved → not_found (scope)', async () => {
    const row = { ...ROW, status: 'bound', companyId: 'co-B' };
    expect(await claimInbound(fake('inboundMessage', row).prisma, manager(), { id: 'i1' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('своя компания, но статус bound → lifecycle_violation', async () => {
    const row = { ...ROW, status: 'bound', companyId: 'co-A' };
    expect(await claimInbound(fake('inboundMessage', row).prisma, manager(), { id: 'i1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('чужой claim → already_assigned; свой → идемпотентно', async () => {
    expect(await claimInbound(fake('inboundMessage', { ...ROW, claimedByUserId: 'm2' }).prisma, manager(), { id: 'i1' })).toEqual({ ok: false, error: 'already_assigned' });
    expect(await claimInbound(fake('inboundMessage', { ...ROW, claimedByUserId: 'm1' }).prisma, manager(), { id: 'i1' })).toEqual({ ok: true, changed: false });
  });

  it('forbidden для клиентской роли', async () => {
    expect(await claimInbound(fake('inboundMessage', ROW).prisma, partner(), { id: 'i1' })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('claimCall / closeCallIntake', () => {
  const ROW = { id: 'c1', companyId: null, claimedByUserId: null, intakeClosedAt: null };

  it('claim: успех, чужая компания → not_found, закрытый → lifecycle', async () => {
    expect(await claimCall(fake('call', ROW).prisma, manager(), { id: 'c1' })).toEqual({ ok: true, changed: true });
    expect(await claimCall(fake('call', { ...ROW, companyId: 'co-B' }).prisma, manager(), { id: 'c1' })).toEqual({ ok: false, error: 'not_found' });
    expect(await claimCall(fake('call', { ...ROW, intakeClosedAt: new Date() }).prisma, manager(), { id: 'c1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(await claimCall(fake('call', { ...ROW, claimedByUserId: 'm2' }).prisma, manager(), { id: 'c1' })).toEqual({ ok: false, error: 'already_assigned' });
    expect(await claimCall(fake('call', { ...ROW, claimedByUserId: 'm1' }).prisma, manager(), { id: 'c1' })).toEqual({ ok: true, changed: false });
  });

  it('claim: клиентская роль → forbidden, БД не читаем', async () => {
    // Звонки — внутренний контур: партнёр не должен даже узнать, существует ли
    // звонок с таким id. Гейт стоит до любого запроса.
    const f = fake('call', ROW);
    expect(await claimCall(f.prisma, partner(), { id: 'c1' })).toEqual({ ok: false, error: 'forbidden' });
    expect(f.findUnique).not.toHaveBeenCalled();
  });

  it('claim: сессия без companyId видит только общую корзину', async () => {
    const row = { ...ROW, companyId: 'co-A' };
    expect(await claimCall(fake('call', row).prisma, manager({ companyId: null }), { id: 'c1' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('close: успех (+аудит), повторно — идемпотентно, forbidden для клиента', async () => {
    const first = fake('call', ROW);
    expect(await closeCallIntake(first.prisma, manager(), { id: 'c1' })).toEqual({ ok: true, changed: true });
    expect(first.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ intakeClosedById: 'm1' }) })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(first.prisma, expect.objectContaining({ action: 'intake_call_closed' }));

    expect(await closeCallIntake(fake('call', { ...ROW, intakeClosedAt: new Date() }).prisma, manager(), { id: 'c1' })).toEqual({ ok: true, changed: false });
    expect(await closeCallIntake(fake('call', ROW).prisma, partner(), { id: 'c1' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await closeCallIntake(fake('call', null).prisma, manager(), { id: 'c1' })).toEqual({ ok: false, error: 'not_found' });
  });
});
