import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, verifyToken, cookiesGet } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  verifyToken: vi.fn(),
  cookiesGet: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique }
  }
}));

vi.mock('@/lib/auth/jwt', () => ({ verifyToken }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: cookiesGet })
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
  select: { isActive: true, sessionVersion: true }
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
