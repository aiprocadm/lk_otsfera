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

const PAYLOAD = { sub: 'user-1', role: 'partner' as const };

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
    verifyToken.mockResolvedValue(PAYLOAD);
    findUnique.mockResolvedValue(null);

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { isActive: true } });
  });

  it('returns null when user.isActive is false', async () => {
    cookiesGet.mockReturnValue({ value: 'valid-token' });
    verifyToken.mockResolvedValue(PAYLOAD);
    findUnique.mockResolvedValue({ isActive: false });

    const result = await getSession();

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { isActive: true } });
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
    verifyToken.mockResolvedValue(PAYLOAD);
    findUnique.mockResolvedValue({ isActive: true });

    const result = await getSession();

    expect(result).toEqual(PAYLOAD);
  });
});
