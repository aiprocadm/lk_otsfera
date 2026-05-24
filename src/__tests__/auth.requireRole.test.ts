import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));

vi.mock('next/navigation', () => ({ redirect }));

import { requireSession, requireAdmin, requirePartnerAdmin } from '@/lib/auth/requireRole';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN_SESSION: SessionPayload = { sub: 'user-admin', role: 'admin' };
const PARTNER_ADMIN_SESSION: SessionPayload = { sub: 'user-partner', role: 'partner', partnerRole: 'admin' };
const PARTNER_MANAGER_SESSION: SessionPayload = { sub: 'user-pm', role: 'partner', partnerRole: 'manager' };
const MANAGER_SESSION: SessionPayload = { sub: 'user-mgr', role: 'manager' };
const ORG_SESSION: SessionPayload = { sub: 'user-org', role: 'organization' };

describe('requireSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session when getSession returns a payload', async () => {
    getSession.mockResolvedValue(ADMIN_SESSION);

    const result = await requireSession();

    expect(result).toEqual(ADMIN_SESSION);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('calls redirect(\'/login\') when getSession returns null', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requireSession()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for admin role', async () => {
    getSession.mockResolvedValue(ADMIN_SESSION);

    const result = await requireAdmin();

    expect(result).toEqual(ADMIN_SESSION);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for partner role', async () => {
    getSession.mockResolvedValue(PARTNER_ADMIN_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for manager role', async () => {
    getSession.mockResolvedValue(MANAGER_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for organization role', async () => {
    getSession.mockResolvedValue(ORG_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('calls redirect(\'/login\') when session is null', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('requirePartnerAdmin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for role=partner + partnerRole=admin', async () => {
    getSession.mockResolvedValue(PARTNER_ADMIN_SESSION);

    const result = await requirePartnerAdmin();

    expect(result).toEqual(PARTNER_ADMIN_SESSION);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for role=partner + partnerRole=manager', async () => {
    getSession.mockResolvedValue(PARTNER_MANAGER_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartnerAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for non-partner role (admin)', async () => {
    getSession.mockResolvedValue(ADMIN_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartnerAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden for non-partner role (manager)', async () => {
    getSession.mockResolvedValue(MANAGER_SESSION);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartnerAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('calls redirect(\'/login\') when session is null', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(requirePartnerAdmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
