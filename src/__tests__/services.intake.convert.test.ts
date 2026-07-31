/**
 * Этап 7 (ФТ-1.6) — конверсии «обращение/звонок → лид»: гейт, scope,
 * already_converted, валидация, транзакция (лид + пометка источника).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { createLeadFromInbound, createLeadFromCall } from '@/lib/services/intake/convert';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' }) as unknown as SessionPayload;

const INPUT = {
  companyName: 'ООО Тест',
  contactName: 'Иван',
  contactPhone: '+79990000000',
  contactEmail: 'ivan@test.ru',
  subject: 'Обучение по ОТ',
};

function makePrisma(sourceModel: 'inboundMessage' | 'call', row: unknown) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const leadCreate = vi.fn().mockResolvedValue({ id: 'lead-1' });
  const sourceUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    lead: { create: leadCreate },
    inboundMessage: { update: sourceUpdate },
    call: { update: sourceUpdate },
  };
  const prisma = {
    [sourceModel]: { findUnique },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, findUnique, leadCreate, sourceUpdate };
}

beforeEach(() => recordAuditMock.mockReset());

describe('createLeadFromInbound', () => {
  const MSG = { id: 'i1', status: 'unresolved', companyId: null, resolvedOrgId: null, lead: null };

  it('forbidden для клиентской роли', async () => {
    const { prisma } = makePrisma('inboundMessage', MSG);
    expect(
      await createLeadFromInbound(prisma, partner(), { inboundId: 'i1', input: INPUT })
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('успех: лид с source/sourceInboundId + обращение → bound с компанией сессии; аудит', async () => {
    const { prisma, leadCreate, sourceUpdate } = makePrisma('inboundMessage', MSG);
    const r = await createLeadFromInbound(prisma, manager(), { inboundId: 'i1', input: INPUT });
    expect(r.ok).toBe(true);
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'inbound_message',
          sourceInboundId: 'i1',
          clientCompanyName: 'ООО Тест',
          createdByUserId: 'm1',
        }),
      })
    );
    expect(sourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'bound', boundById: 'm1', companyId: 'co-A' }),
      })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'lead_created_from_inbound' })
    );
  });

  it('заметка из формы сохраняется обрезанной; компания берётся с самого обращения', async () => {
    // Обращение уже привязано к компании — её и оставляем, а не подменяем
    // компанией сотрудника (иначе перевесили бы обращение в другую компанию).
    const { prisma, leadCreate, sourceUpdate } = makePrisma('inboundMessage', {
      ...MSG,
      companyId: 'co-A',
    });
    const r = await createLeadFromInbound(prisma, manager(), {
      inboundId: 'i1',
      input: { ...INPUT, notes: '  Просили перезвонить после обеда  ' },
    });
    expect(r.ok).toBe(true);
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Просили перезвонить после обеда' }),
      })
    );
    expect(sourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-A' }) })
    );
  });

  it('ни у обращения, ни у сотрудника нет компании → остаётся без компании', async () => {
    const noCompany = { sub: 'm1', role: 'manager' } as unknown as SessionPayload;
    const { prisma, sourceUpdate } = makePrisma('inboundMessage', MSG);
    const r = await createLeadFromInbound(prisma, noCompany, { inboundId: 'i1', input: INPUT });
    expect(r.ok).toBe(true);
    expect(sourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) })
    );
  });

  it('пустая заметка (одни пробелы) не сохраняется как пустая строка', async () => {
    const { prisma, leadCreate } = makePrisma('inboundMessage', MSG);
    await createLeadFromInbound(prisma, manager(), {
      inboundId: 'i1',
      input: { ...INPUT, notes: '   ' },
    });
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: null }) })
    );
  });

  it('уже сконвертировано → already_converted', async () => {
    const { prisma } = makePrisma('inboundMessage', { ...MSG, lead: { id: 'lead-9' } });
    expect(
      await createLeadFromInbound(prisma, manager(), { inboundId: 'i1', input: INPUT })
    ).toEqual({ ok: false, error: 'already_converted' });
  });

  it('вне scope (чужая компания, не unresolved) → not_found; отсутствует → not_found', async () => {
    const { prisma } = makePrisma('inboundMessage', { ...MSG, status: 'bound', companyId: 'co-B' });
    expect(
      await createLeadFromInbound(prisma, manager(), { inboundId: 'i1', input: INPUT })
    ).toEqual({ ok: false, error: 'not_found' });
    const none = makePrisma('inboundMessage', null);
    expect(
      await createLeadFromInbound(none.prisma, manager(), { inboundId: 'x', input: INPUT })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('валидация: пустые поля → validation с русскими сообщениями', async () => {
    const { prisma, leadCreate } = makePrisma('inboundMessage', MSG);
    const r = await createLeadFromInbound(prisma, manager(), { inboundId: 'i1', input: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('validation');
      expect(r.messages?.length).toBeGreaterThan(0);
    }
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('resolvedOrgId наследуется лидом', async () => {
    const { prisma, leadCreate } = makePrisma('inboundMessage', { ...MSG, resolvedOrgId: 'org-7' });
    await createLeadFromInbound(prisma, manager(), { inboundId: 'i1', input: INPUT });
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-7' }) })
    );
  });
});

describe('createLeadFromCall', () => {
  const CALL = { id: 'c1', companyId: null, resolvedOrgId: null, lead: null };

  it('успех: source=call + звонок получает ответственного; аудит', async () => {
    const { prisma, leadCreate, sourceUpdate } = makePrisma('call', CALL);
    const r = await createLeadFromCall(prisma, manager(), { callId: 'c1', input: INPUT });
    expect(r.ok).toBe(true);
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'call', sourceCallId: 'c1' }),
      })
    );
    expect(sourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ claimedByUserId: 'm1' }) })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'lead_created_from_call' })
    );
  });

  it('заметка из формы сохраняется обрезанной', async () => {
    const { prisma, leadCreate } = makePrisma('call', CALL);
    await createLeadFromCall(prisma, manager(), {
      callId: 'c1',
      input: { ...INPUT, notes: '  Перезвонить в понедельник  ' },
    });
    expect(leadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Перезвонить в понедельник' }),
      })
    );
  });

  it('already_converted / not_found (чужая компания) / forbidden / validation', async () => {
    expect(
      await createLeadFromCall(
        makePrisma('call', { ...CALL, lead: { id: 'l' } }).prisma,
        manager(),
        { callId: 'c1', input: INPUT }
      )
    ).toEqual({ ok: false, error: 'already_converted' });
    expect(
      await createLeadFromCall(
        makePrisma('call', { ...CALL, companyId: 'co-B' }).prisma,
        manager(),
        { callId: 'c1', input: INPUT }
      )
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await createLeadFromCall(makePrisma('call', CALL).prisma, partner(), {
        callId: 'c1',
        input: INPUT,
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    const bad = await createLeadFromCall(makePrisma('call', CALL).prisma, manager(), {
      callId: 'c1',
      input: {},
    });
    expect(bad.ok).toBe(false);
  });
});
