import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { findByInn } from '@/lib/services/duplicates/findByInn';

/**
 * Unit-тесты сервиса антидублей по ИНН (этап 5 PR-2, ФТ-13.4):
 *  - RBAC: клиентские роли (partner/organization/student) → forbidden, к БД
 *    не ходим (факт существования ИНН не раскрывается);
 *  - валидация: пусто / 9 цифр / буквы / 11 цифр → validation без запросов;
 *  - нормализация: пробелы и дефисы вычищаются до проверки и поиска;
 *  - happy: организации по точному inn (take 5) + активные лиды по clientInn
 *    (status notIn rejected/promoted_to_order, createdAt desc, take 5),
 *    обе выборки выполняются.
 */

const MANAGER: SessionPayload = { sub: 'm-1', role: 'manager' } as SessionPayload;
const ADMIN: SessionPayload = { sub: 'a-1', role: 'admin' } as SessionPayload;
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'p1' } as SessionPayload;
const ORGANIZATION: SessionPayload = { sub: 'o-1', role: 'organization' } as SessionPayload;
const STUDENT: SessionPayload = { sub: 's-1', role: 'student' } as SessionPayload;

function makePrisma(
  organizations: Array<{ id: string; name: string }> = [],
  leads: Array<{ id: string; subject: string; status: string }> = []
) {
  const orgFindMany = vi.fn().mockResolvedValue(organizations);
  const leadFindMany = vi.fn().mockResolvedValue(leads);
  const prisma = {
    organization: { findMany: orgFindMany },
    lead: { findMany: leadFindMany }
  };
  return { prisma: prisma as never, orgFindMany, leadFindMany };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── ФТ-13.4: клиентским ролям факт наличия ИНН не раскрывается ───────────────

describe('ФТ-13.4: клиентские роли → forbidden, БД не опрашивается', () => {
  it.each([
    ['partner', PARTNER],
    ['organization', ORGANIZATION],
    ['student', STUDENT]
  ] as const)('%s → forbidden без единого запроса к БД', async (_role, session) => {
    const { prisma, orgFindMany, leadFindMany } = makePrisma();
    expect(await findByInn(prisma, session, { inn: '7707083893' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it('гейт срабатывает раньше валидации: partner с мусорным ИНН тоже forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await findByInn(prisma, PARTNER, { inn: 'abc' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

// ─── валидация ────────────────────────────────────────────────────────────────

describe('findByInn — валидация ИНН', () => {
  it.each([
    ['пустая строка', ''],
    ['9 цифр', '123456789'],
    ['11 цифр', '12345678901'],
    ['13 цифр', '1234567890123'],
    ['буквы', '77070838ab'],
    ['цифры с буквой внутри', '7707x83893']
  ])('%s → validation, БД не опрашивается', async (_label, inn) => {
    const { prisma, orgFindMany, leadFindMany } = makePrisma();
    expect(await findByInn(prisma, MANAGER, { inn })).toEqual({
      ok: false,
      error: 'validation'
    });
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it('ИНН вообще не передан → validation, а не падение', async () => {
    // Поиск дублей зовётся из формы триажа: поле может отсутствовать в теле
    // запроса. Ожидаем вежливый отказ, не TypeError на `.replace` у undefined.
    const { prisma, orgFindMany, leadFindMany } = makePrisma();
    expect(await findByInn(prisma, MANAGER, {} as never)).toEqual({
      ok: false,
      error: 'validation'
    });
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });
});

// ─── нормализация ─────────────────────────────────────────────────────────────

describe('findByInn — нормализация пробелов и дефисов', () => {
  it('10 цифр с пробелами и дефисами → ищем по чистому ИНН', async () => {
    const { prisma, orgFindMany, leadFindMany } = makePrisma();
    const res = await findByInn(prisma, MANAGER, { inn: ' 7707 083-893 ' });
    expect(res.ok).toBe(true);
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inn: '7707083893' } })
    );
    expect(leadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientInn: '7707083893' }) })
    );
  });

  it('12 цифр с дефисами (ИП) → валидны и нормализуются', async () => {
    const { prisma, orgFindMany } = makePrisma();
    const res = await findByInn(prisma, ADMIN, { inn: '7707-0838-93-12' });
    expect(res.ok).toBe(true);
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inn: '770708389312' } })
    );
  });

  it('пробелы/дефисы не спасают невалидную длину: «12-34» → validation', async () => {
    const { prisma } = makePrisma();
    expect(await findByInn(prisma, MANAGER, { inn: '12-34' })).toEqual({
      ok: false,
      error: 'validation'
    });
  });
});

// ─── happy path ───────────────────────────────────────────────────────────────

describe('findByInn — happy path (manager/admin)', () => {
  const ORGS = [{ id: 'org-1', name: 'ООО Ромашка' }];
  const LEADS = [{ id: 'lead-1', subject: 'Обучение ОТ', status: 'new' }];

  it('организации: точный inn, select id/name, take 5', async () => {
    const { prisma, orgFindMany } = makePrisma(ORGS, LEADS);
    const res = await findByInn(prisma, MANAGER, { inn: '7707083893' });
    expect(res).toEqual({ ok: true, duplicates: { organizations: ORGS, leads: LEADS } });
    expect(orgFindMany).toHaveBeenCalledTimes(1);
    expect(orgFindMany).toHaveBeenCalledWith({
      where: { inn: '7707083893' },
      select: { id: true, name: true },
      take: 5
    });
  });

  it('лиды: clientInn + status notIn rejected/promoted_to_order, createdAt desc, take 5', async () => {
    const { prisma, leadFindMany } = makePrisma(ORGS, LEADS);
    await findByInn(prisma, MANAGER, { inn: '7707083893' });
    expect(leadFindMany).toHaveBeenCalledTimes(1);
    expect(leadFindMany).toHaveBeenCalledWith({
      where: { clientInn: '7707083893', status: { notIn: ['rejected', 'promoted_to_order'] } },
      select: { id: true, subject: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
  });

  it('обе выборки выполняются в одном вызове (параллельная пара)', async () => {
    const { prisma, orgFindMany, leadFindMany } = makePrisma();
    await findByInn(prisma, MANAGER, { inn: '7707083893' });
    expect(orgFindMany).toHaveBeenCalledTimes(1);
    expect(leadFindMany).toHaveBeenCalledTimes(1);
  });

  it('admin тоже допущен; пустые выборки → пустые массивы', async () => {
    const { prisma } = makePrisma([], []);
    expect(await findByInn(prisma, ADMIN, { inn: '770708389312' })).toEqual({
      ok: true,
      duplicates: { organizations: [], leads: [] }
    });
  });
});
