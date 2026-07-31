/**
 * Unit tests for src/lib/services/manager/createLead.ts (этап 5, ФТ-1.6).
 *
 * createLeadByStaff — ручное создание лида: только manager/admin; валидация
 * переиспользует validateClientRequestInput; организация — из компании
 * менеджера (C8), admin — любая; source=manual, partnerId=null; аудит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { createLeadByStaff } from '@/lib/services/manager/createLead';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MANAGER: SessionPayload = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const ADMIN: SessionPayload = { sub: 'a1', role: 'admin' } as SessionPayload;

const VALID = {
  companyName: 'ООО Ромашка',
  contactName: 'Иван Иванов',
  contactPhone: '+7 900 000-00-00',
  subject: 'Обучение',
};

function db(over: Record<string, unknown> = {}) {
  const leadCreate = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'L1',
      ...data,
    }));
  const orgFindUnique = vi.fn().mockResolvedValue({ companyId: 'c1' });
  const prisma = {
    lead: { create: leadCreate },
    organization: { findUnique: orgFindUnique },
    ...over,
  };
  return { prisma: prisma as never, leadCreate, orgFindUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe('createLeadByStaff — RBAC', () => {
  it('forbidden для partner/organization/student (партнёрское создание лидов запрещено, ФТ-1.5)', async () => {
    const { prisma, leadCreate } = db();
    for (const role of ['partner', 'organization', 'student'] as const) {
      expect(await createLeadByStaff(prisma, { sub: 'x', role } as SessionPayload, VALID)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(leadCreate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ─── validation (переиспользует validateClientRequestInput) ───────────────────

describe('createLeadByStaff — validation', () => {
  it('пустой вход → те же русские сообщения, что у заявки клиента', async () => {
    const { prisma } = db();
    const r = await createLeadByStaff(prisma, MANAGER, {});
    expect(r).toMatchObject({ ok: false, error: 'validation' });
    expect((r as { messages: string[] }).messages).toEqual([
      'Укажите название компании',
      'Укажите контактное лицо',
      'Укажите тему обращения',
      'Укажите телефон или email для связи',
    ]);
  });

  it('кривой ИНН → та же ветка формата', async () => {
    const { prisma } = db();
    const r = await createLeadByStaff(prisma, MANAGER, { ...VALID, inn: '123' });
    expect((r as { messages: string[] }).messages).toEqual(['ИНН должен содержать 10 или 12 цифр']);
  });
});

// ─── организация ──────────────────────────────────────────────────────────────

describe('createLeadByStaff — организация', () => {
  it('организация не найдена → validation «Организация не найдена»', async () => {
    const { prisma } = db({ organization: { findUnique: vi.fn().mockResolvedValue(null) } });
    expect(await createLeadByStaff(prisma, MANAGER, { ...VALID, organizationId: 'oX' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Организация не найдена'],
    });
  });

  it('чужая компания для manager → forbidden', async () => {
    const { prisma, leadCreate } = db({
      organization: { findUnique: vi.fn().mockResolvedValue({ companyId: 'c2' }) },
    });
    expect(await createLeadByStaff(prisma, MANAGER, { ...VALID, organizationId: 'o1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('manager без companyId не может привязать организацию вовсе', async () => {
    const { prisma } = db();
    const session = { sub: 'm1', role: 'manager', companyId: null } as SessionPayload;
    expect(await createLeadByStaff(prisma, session, { ...VALID, organizationId: 'o1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('admin — любая организация, включая чужую компанию', async () => {
    const { prisma, leadCreate } = db({
      organization: { findUnique: vi.fn().mockResolvedValue({ companyId: 'c-other' }) },
    });
    const r = await createLeadByStaff(prisma, ADMIN, { ...VALID, organizationId: 'o9' });
    if (!r.ok) throw new Error('expected ok');
    expect(leadCreate.mock.calls[0][0].data.organizationId).toBe('o9');
  });

  it('без organizationId (пустая строка → null) организация не проверяется', async () => {
    const { prisma, orgFindUnique, leadCreate } = db();
    const r = await createLeadByStaff(prisma, MANAGER, { ...VALID, organizationId: '  ' });
    if (!r.ok) throw new Error('expected ok');
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(leadCreate.mock.calls[0][0].data.organizationId).toBeNull();
  });
});

// ─── happy path + аудит ───────────────────────────────────────────────────────

describe('createLeadByStaff — happy', () => {
  it('source=manual, partnerId=null, поля из валидации, status=new', async () => {
    const { prisma, leadCreate } = db();
    const r = await createLeadByStaff(prisma, MANAGER, {
      ...VALID,
      inn: ' 77-12 345 678 ',
      contactEmail: ' Ivan@X.RU ',
      organizationId: 'o1',
      notes: '  Позвонить после обеда  ',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(leadCreate).toHaveBeenCalledWith({
      data: {
        source: 'manual',
        partnerId: null,
        organizationId: 'o1',
        createdByUserId: 'm1',
        clientCompanyName: 'ООО Ромашка',
        clientInn: '7712345678',
        clientContactName: 'Иван Иванов',
        clientContactPhone: '+7 900 000-00-00',
        clientContactEmail: 'ivan@x.ru',
        subject: 'Обучение',
        notes: 'Позвонить после обеда',
        status: 'new',
      },
    });
  });

  it('notes приоритетнее body: при обоих в notes попадает notes', async () => {
    const { prisma, leadCreate } = db();
    // body не входит в CreateLeadByStaffInput, но валидатор его читает —
    // проверяем, что явный notes перекрывает такой «пролезший» body.
    const r = await createLeadByStaff(prisma, ADMIN, {
      ...VALID,
      notes: 'из notes',
      body: 'из body',
    } as never);
    if (!r.ok) throw new Error('expected ok');
    expect(leadCreate.mock.calls[0][0].data.notes).toBe('из notes');
  });

  it('без notes: падает в body из валидации (null, если body не передан)', async () => {
    const { prisma, leadCreate } = db();
    const r = await createLeadByStaff(prisma, ADMIN, VALID);
    if (!r.ok) throw new Error('expected ok');
    expect(leadCreate.mock.calls[0][0].data.notes).toBeNull();
  });

  it('аудит lead_created_manual: after без ПДн (organizationId + source)', async () => {
    const { prisma } = db();
    const r = await createLeadByStaff(prisma, MANAGER, { ...VALID, organizationId: 'o1' });
    if (!r.ok) throw new Error('expected ok');
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm1',
      action: 'lead_created_manual',
      entity: 'lead',
      entityId: 'L1',
      after: { organizationId: 'o1', source: 'manual' },
    });
    expect(JSON.stringify(recordAudit.mock.calls[0][1].after)).not.toContain('Иван');
  });
});
