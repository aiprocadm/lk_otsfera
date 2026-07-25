/**
 * Unit tests for src/lib/services/clientRequests/submit.ts (этап 5, Модуль 1).
 *
 * validateClientRequestInput — чистая валидация (§9-2): русские сообщения,
 * нормализация ИНН/email; submitClientRequest — RBAC клиентских ролей,
 * принадлежность из сессии, аудит без ПДн, best-effort уведомление менеджерам.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { notifyManagersClientRequestSubmitted } = vi.hoisted(() => ({
  notifyManagersClientRequestSubmitted: vi.fn()
}));
vi.mock('@/lib/services/clientRequests/notify', () => ({
  notifyManagersClientRequestSubmitted,
  notifySubmitterClientRequestStatus: vi.fn()
}));

import { validateClientRequestInput, submitClientRequest } from '@/lib/services/clientRequests/submit';

// ─── helpers ──────────────────────────────────────────────────────────────────

const s = (over: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'u1', role: 'partner', ...over }) as SessionPayload;

const VALID = {
  companyName: 'ООО Ромашка',
  contactName: 'Иван Иванов',
  contactPhone: '+7 900 000-00-00',
  subject: 'Обучение по охране труда'
};

function db(over: Record<string, unknown> = {}) {
  const create = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'R1', ...data }));
  const prisma = { clientRequest: { create }, ...over };
  return { prisma: prisma as never, create };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifyManagersClientRequestSubmitted.mockResolvedValue(undefined);
});

// ─── validateClientRequestInput ───────────────────────────────────────────────

describe('validateClientRequestInput — обязательные поля', () => {
  it('пустой вход: все четыре русских сообщения разом', () => {
    const r = validateClientRequestInput({});
    expect(r).toEqual({
      ok: false,
      errors: [
        'Укажите название компании',
        'Укажите контактное лицо',
        'Укажите тему обращения',
        'Укажите телефон или email для связи'
      ]
    });
  });

  it('нет компании (пробелы не считаются)', () => {
    const r = validateClientRequestInput({ ...VALID, companyName: '   ' });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Укажите название компании']);
  });

  it('нет контактного лица', () => {
    const r = validateClientRequestInput({ ...VALID, contactName: null });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Укажите контактное лицо']);
  });

  it('нет темы обращения', () => {
    const r = validateClientRequestInput({ ...VALID, subject: '' });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Укажите тему обращения']);
  });

  it('ни телефона, ни email → «Укажите телефон или email для связи»', () => {
    const r = validateClientRequestInput({ ...VALID, contactPhone: '  ', contactEmail: null });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Укажите телефон или email для связи']);
  });
});

describe('validateClientRequestInput — email и ИНН', () => {
  it('кривой email: сообщение содержит сам (уже lower-case) email', () => {
    const r = validateClientRequestInput({ ...VALID, contactPhone: null, contactEmail: ' NOT-AN-EMAIL ' });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Некорректный email «not-an-email»']);
  });

  it('email с пробелом внутри — тоже некорректен', () => {
    const r = validateClientRequestInput({ ...VALID, contactEmail: 'a b@x.ru' });
    if (r.ok) throw new Error('expected errors');
    expect(r.errors).toEqual(['Некорректный email «a b@x.ru»']);
  });

  it('ИНН не из 10/12 цифр → ошибка формата', () => {
    for (const inn of ['123', '12345678901', 'abcdefghij']) {
      const r = validateClientRequestInput({ ...VALID, inn });
      if (r.ok) throw new Error('expected errors');
      expect(r.errors).toEqual(['ИНН должен содержать 10 или 12 цифр']);
    }
  });

  it('ИНН с пробелами и дефисами нормализуется до цифр (10 и 12)', () => {
    const r10 = validateClientRequestInput({ ...VALID, inn: ' 77-12 34 56-78 ' });
    if (!r10.ok) throw new Error('expected ok');
    expect(r10.values.inn).toBe('7712345678');
    const r12 = validateClientRequestInput({ ...VALID, inn: '50-04 05 06-07 08' });
    if (!r12.ok) throw new Error('expected ok');
    expect(r12.values.inn).toBe('500405060708');
  });
});

describe('validateClientRequestInput — happy path', () => {
  it('все поля: trim, email в lower-case, body сохраняется', () => {
    const r = validateClientRequestInput({
      companyName: '  ООО Ромашка ',
      inn: '7712345678',
      contactName: ' Иван Иванов ',
      contactPhone: ' +7 900 000-00-00 ',
      contactEmail: ' Ivan@Example.RU ',
      subject: ' Обучение ',
      body: ' Хотим обучить 5 сотрудников. '
    });
    expect(r).toEqual({
      ok: true,
      values: {
        companyName: 'ООО Ромашка',
        inn: '7712345678',
        contactName: 'Иван Иванов',
        contactPhone: '+7 900 000-00-00',
        contactEmail: 'ivan@example.ru',
        subject: 'Обучение',
        body: 'Хотим обучить 5 сотрудников.'
      }
    });
  });

  it('минимум: только обязательные + телефон; необязательные → null', () => {
    const r = validateClientRequestInput(VALID);
    expect(r).toEqual({
      ok: true,
      values: {
        companyName: 'ООО Ромашка',
        inn: null,
        contactName: 'Иван Иванов',
        contactPhone: '+7 900 000-00-00',
        contactEmail: null,
        subject: 'Обучение по охране труда',
        body: null
      }
    });
  });

  it('минимум с одним email (без телефона) — тоже ок', () => {
    const r = validateClientRequestInput({ ...VALID, contactPhone: null, contactEmail: 'i@x.ru' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.values.contactPhone).toBeNull();
    expect(r.values.contactEmail).toBe('i@x.ru');
  });
});

// ─── submitClientRequest ──────────────────────────────────────────────────────

describe('submitClientRequest — RBAC', () => {
  it('forbidden для manager/admin/student (подают только клиентские роли)', async () => {
    const { prisma, create } = db();
    for (const role of ['manager', 'admin', 'student'] as const) {
      expect(await submitClientRequest(prisma, s({ role }), VALID)).toEqual({
        ok: false,
        error: 'forbidden'
      });
    }
    expect(create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(notifyManagersClientRequestSubmitted).not.toHaveBeenCalled();
  });

  it('validation: русские сообщения пробрасываются наружу', async () => {
    const { prisma, create } = db();
    const r = await submitClientRequest(prisma, s({ role: 'partner', partnerId: 'p1' }), {});
    expect(r).toMatchObject({ ok: false, error: 'validation' });
    expect((r as { messages: string[] }).messages).toContain('Укажите название компании');
    expect(create).not.toHaveBeenCalled();
  });

  it('партнёр без partnerId в сессии → forbidden', async () => {
    const { prisma, create } = db();
    expect(await submitClientRequest(prisma, s({ role: 'partner', partnerId: null }), VALID)).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('submitClientRequest — партнёр', () => {
  it('source=partner_cabinet, partnerId из сессии (не из входа), organizationId=null', async () => {
    const { prisma, create } = db();
    const r = await submitClientRequest(prisma, s({ role: 'partner', partnerId: 'p1' }), VALID);
    if (!r.ok) throw new Error('expected ok');
    expect(create.mock.calls[0][0].data).toMatchObject({
      source: 'partner_cabinet',
      submittedByUserId: 'u1',
      partnerId: 'p1',
      organizationId: null,
      companyName: 'ООО Ромашка'
    });
  });
});

describe('submitClientRequest — организация', () => {
  const member = (id: string, isActive = true) =>
    ({ organizationId: id, roleInOrg: 'member', isActive }) as const;

  it('явный чужой organizationId (не в активных членствах) → forbidden', async () => {
    const { prisma, create } = db();
    const session = s({ role: 'organization', organizationMemberships: [member('o1'), member('o2', false)] });
    expect(await submitClientRequest(prisma, session, { ...VALID, organizationId: 'o2' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(await submitClientRequest(prisma, session, { ...VALID, organizationId: 'oX' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('явный свой organizationId — ок; source=organization_cabinet, partnerId=null', async () => {
    const { prisma, create } = db();
    const session = s({ role: 'organization', organizationMemberships: [member('o1'), member('o2')] });
    const r = await submitClientRequest(prisma, session, { ...VALID, organizationId: 'o2' });
    if (!r.ok) throw new Error('expected ok');
    expect(create.mock.calls[0][0].data).toMatchObject({
      source: 'organization_cabinet',
      partnerId: null,
      organizationId: 'o2'
    });
  });

  it('дефолт: активная организация из session.organizationId', async () => {
    const { prisma, create } = db();
    const session = s({
      role: 'organization',
      organizationId: 'o2',
      organizationMemberships: [member('o1'), member('o2')]
    });
    const r = await submitClientRequest(prisma, session, VALID);
    if (!r.ok) throw new Error('expected ok');
    expect(create.mock.calls[0][0].data.organizationId).toBe('o2');
  });

  it('дефолт без session.organizationId: первое активное членство', async () => {
    const { prisma, create } = db();
    const session = s({
      role: 'organization',
      organizationMemberships: [member('o9', false), member('o1'), member('o2')]
    });
    const r = await submitClientRequest(prisma, session, VALID);
    if (!r.ok) throw new Error('expected ok');
    expect(create.mock.calls[0][0].data.organizationId).toBe('o1');
  });

  it('без членств и без organizationId → forbidden', async () => {
    const { prisma } = db();
    expect(await submitClientRequest(prisma, s({ role: 'organization' }), VALID)).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(
      await submitClientRequest(prisma, s({ role: 'organization', organizationMemberships: [] }), VALID)
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('submitClientRequest — аудит и уведомление', () => {
  it('аудит без ПДн: after только source/partnerId/organizationId', async () => {
    const { prisma } = db();
    const r = await submitClientRequest(
      prisma,
      s({ role: 'partner', partnerId: 'p1' }),
      { ...VALID, contactEmail: 'ivan@example.ru' }
    );
    if (!r.ok) throw new Error('expected ok');
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'u1',
      action: 'client_request_submitted',
      entity: 'client_request',
      entityId: 'R1',
      after: { source: 'partner_cabinet', partnerId: 'p1', organizationId: null }
    });
    const after = JSON.stringify(recordAudit.mock.calls[0][1].after);
    expect(after).not.toContain('ivan@example.ru');
    expect(after).not.toContain('Иван');
    expect(after).not.toContain('+7');
  });

  it('после создания зовёт notifyManagersClientRequestSubmitted с созданной заявкой', async () => {
    const { prisma } = db();
    const r = await submitClientRequest(prisma, s({ role: 'partner', partnerId: 'p1' }), VALID);
    if (!r.ok) throw new Error('expected ok');
    expect(notifyManagersClientRequestSubmitted).toHaveBeenCalledTimes(1);
    expect(notifyManagersClientRequestSubmitted).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'R1', source: 'partner_cabinet' })
    );
  });
});
