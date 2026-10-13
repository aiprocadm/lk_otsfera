import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, findManyAssignments, verifyToken, cookiesGet } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findManyAssignments: vi.fn(),
  verifyToken: vi.fn(),
  cookiesGet: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique },
    organizationManager: { findMany: findManyAssignments },
  },
}));

vi.mock('@/lib/auth/jwt', () => ({ verifyToken }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: cookiesGet }),
}));

import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth/session';

// Токен «до релиза» — без клейма sessionVersion (обратная совместимость).
const PAYLOAD = { sub: 'user-1', role: 'partner' as const };
// Токен «после релиза» — клейм проставлен buildSessionClaims.
const PAYLOAD_V0 = { ...PAYLOAD, sessionVersion: 0 };

// Выборка getSession читает обе колонки: активность и версию сессии.
const EXPECTED_SELECT = {
  where: { id: 'user-1' },
  select: { isActive: true, sessionVersion: true },
};

describe('getSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: cookiesGet } as any);
  });

  it('returns null when no session cookie', async () => {
    cookiesGet.mockReturnValue(undefined);

    const result = await getSession();

    expect(result).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns null when verifyToken throws', async () => {
    cookiesGet.mockReturnValue({ value: 'bad-token' });
    verifyToken.mockRejectedValue(new Error('invalid'));

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns null when user is not found in DB', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue(PAYLOAD_V0);
    findUnique.mockResolvedValue(null);

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(EXPECTED_SELECT);
  });

  it('returns null when user.isActive is false', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue(PAYLOAD_V0);
    findUnique.mockResolvedValue({ isActive: false, sessionVersion: 0 });

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(EXPECTED_SELECT);
  });

  it('returns null when verifyToken returns payload without sub', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue({ sub: undefined, role: 'partner' as const });

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns null when verifyToken returns payload with empty sub', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue({ sub: '', role: 'partner' as const });

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns session payload when user.isActive is true', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue(PAYLOAD_V0);
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 0 });

    const result = await getSession();

    expect(result).toEqual(PAYLOAD_V0);
  });
});

// ---------------------------------------------------------------------------
// Этап 9 (ФТ-11.2) — ревокация сессий через User.sessionVersion.
// ---------------------------------------------------------------------------

describe('getSession — сверка sessionVersion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: cookiesGet } as any);
    cookiesGet.mockReturnValue({ value: 'valid-token' });
  });

  it('пускает, когда версия в токене совпадает с версией пользователя', async () => {
    const payload = { ...PAYLOAD, sessionVersion: 3 };
    verifyToken.mockResolvedValue(payload);
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 3 });

    await expect(getSession()).resolves.toEqual(payload);
  });

  it('отвергает токен со старой версией (сессии были отозваны)', async () => {
    verifyToken.mockResolvedValue({ ...PAYLOAD, sessionVersion: 2 });
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 3 });

    await expect(getSession()).resolves.toBeNull();
  });

  it('отвергает токен с версией новее пользовательской (рассинхрон/подделка)', async () => {
    verifyToken.mockResolvedValue({ ...PAYLOAD, sessionVersion: 5 });
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 3 });

    await expect(getSession()).resolves.toBeNull();
  });

  it('токен БЕЗ клейма читается как версия 0 и остаётся валидным при sessionVersion=0', async () => {
    // Обратная совместимость: токены, выданные до деплоя, живут свои 7 дней.
    verifyToken.mockResolvedValue(PAYLOAD);
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 0 });

    await expect(getSession()).resolves.toEqual(PAYLOAD);
  });

  it('токен БЕЗ клейма отвергается после первой ревокации (sessionVersion=1)', async () => {
    // Именно так релиз «убивает» старые токены: версия выросла — legacy-токен (0) больше не подходит.
    verifyToken.mockResolvedValue(PAYLOAD);
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 1 });

    await expect(getSession()).resolves.toBeNull();
  });

  it('деактивированный пользователь отвергается раньше сверки версий', async () => {
    verifyToken.mockResolvedValue({ ...PAYLOAD, sessionVersion: 7 });
    findUnique.mockResolvedValue({ isActive: false, sessionVersion: 7 });

    await expect(getSession()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `У-275` (`Д-50`, ТЗ 13.10.2026): закреплённые организации читаются свежими.
// ---------------------------------------------------------------------------

describe('getSession — организации менеджера без повторного входа (У-275)', () => {
  // Токен выдан ДО назначения: список организаций в нём пуст.
  const MANAGER = {
    sub: 'mgr-1',
    role: 'manager' as const,
    companyId: 'co-1',
    sessionVersion: 0,
    managedOrgIds: [] as string[],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: cookiesGet } as any);
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    findUnique.mockResolvedValue({ isActive: true, sessionVersion: 0 });
  });

  it('организация, назначенная после входа, видна сразу', async () => {
    verifyToken.mockResolvedValue(MANAGER);
    findManyAssignments.mockResolvedValue([{ organizationId: 'org-new' }]);

    const session = await getSession();

    expect(session?.managedOrgIds).toEqual(['org-new']);
    // Тот же запрос, что при входе: только активные и только своей компании (C8).
    expect(findManyAssignments).toHaveBeenCalledWith({
      where: { userId: 'mgr-1', isActive: true, organization: { companyId: 'co-1' } },
      select: { organizationId: true },
    });
  });

  it('снятие назначения действует сразу — снимок в токене не спасает', async () => {
    verifyToken.mockResolvedValue({ ...MANAGER, managedOrgIds: ['org-old'] });
    findManyAssignments.mockResolvedValue([]);

    await expect(getSession()).resolves.toMatchObject({ managedOrgIds: [] });
  });

  it('руководитель — тот же контур: список тоже свежий', async () => {
    verifyToken.mockResolvedValue({ ...MANAGER, role: 'leader' as const });
    findManyAssignments.mockResolvedValue([{ organizationId: 'org-1' }]);

    await expect(getSession()).resolves.toMatchObject({ managedOrgIds: ['org-1'] });
  });

  it('менеджер без компании — пустой список, в базу не ходим (C8 deny-null)', async () => {
    verifyToken.mockResolvedValue({ ...MANAGER, companyId: null, managedOrgIds: ['org-x'] });

    await expect(getSession()).resolves.toMatchObject({ managedOrgIds: [] });
    expect(findManyAssignments).not.toHaveBeenCalled();
  });

  it('токен без companyId читается как «без компании»', async () => {
    const { companyId: _drop, ...noCompany } = MANAGER;
    verifyToken.mockResolvedValue(noCompany);

    await expect(getSession()).resolves.toMatchObject({ managedOrgIds: [] });
    expect(findManyAssignments).not.toHaveBeenCalled();
  });

  it('не менеджерские роли лишнего запроса не делают и токен не меняют', async () => {
    verifyToken.mockResolvedValue({ sub: 'p-1', role: 'partner' as const, sessionVersion: 0 });

    await expect(getSession()).resolves.toEqual({
      sub: 'p-1',
      role: 'partner',
      sessionVersion: 0,
    });
    expect(findManyAssignments).not.toHaveBeenCalled();
  });
});
