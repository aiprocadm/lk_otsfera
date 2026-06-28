import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before imports
// ---------------------------------------------------------------------------
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } }
}));

vi.mock('@/lib/auth/passwordReset', () => ({
  createInviteToken: vi.fn()
}));

vi.mock('@/lib/email/send', () => ({
  send: vi.fn()
}));

// Mock react-dom/server so renderHtml doesn't need a real DOM
vi.mock('react-dom/server', () => ({
  renderToStaticMarkup: vi.fn(() => '<html>mocked</html>')
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { prisma } from '@/lib/db/prisma';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { send } from '@/lib/email/send';
import { POST } from '@/app/api/auth/reset-password/request/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonReq(body: unknown) {
  return new Request('http://x/api/auth/reset-password/request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as import('next/server').NextRequest;
}

const activeUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'user@example.com',
  isActive: true,
};

const inactiveUser = {
  id: 'user-2',
  name: 'Inactive User',
  email: 'inactive@example.com',
  isActive: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/auth/reset-password/request', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.APP_URL = 'https://example.com';
    vi.mocked(createInviteToken).mockResolvedValue({
      token: 'test-token-abc',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    vi.mocked(send).mockResolvedValue({ status: 'sent', id: 'msg-1' });
  });

  it('200 + sends email for existing active user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any);

    const res = await POST(jsonReq({ email: 'user@example.com' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(createInviteToken).toHaveBeenCalledWith(prisma, 'user-1', undefined, 'reset');
    expect(send).toHaveBeenCalledOnce();
    const sendCall = vi.mocked(send).mock.calls[0][0];
    expect(sendCall.to).toBe('user@example.com');
    expect(sendCall.subject).toBe('Восстановление пароля');
    expect(sendCall.html).toContain('mocked');
  });

  it('200 + no email for non-existing email address', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST(jsonReq({ email: 'nobody@example.com' }));

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('200 + no email for deactivated user (isActive=false)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(inactiveUser as any);

    const res = await POST(jsonReq({ email: 'inactive@example.com' }));

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(createInviteToken).not.toHaveBeenCalled();
  });

  it('200 for invalid JSON body (no leak)', async () => {
    const req = new Request('http://x/api/auth/reset-password/request', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('200 for invalid email format (no leak)', async () => {
    const res = await POST(jsonReq({ email: 'not-an-email' }));

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('200 even when email send throws (best-effort, must not propagate)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any);
    vi.mocked(send).mockRejectedValue(new Error('SMTP failure'));

    const res = await POST(jsonReq({ email: 'user@example.com' }));

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    // send was called but failed; token was still created
    expect(createInviteToken).toHaveBeenCalled();
  });

  it('200 even when send throws a non-Error (string) — covers String(err) branch', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any);
    vi.mocked(send).mockRejectedValue('plain string rejection');

    const res = await POST(jsonReq({ email: 'user@example.com' }));

    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(createInviteToken).toHaveBeenCalled();
  });

  it('200 uses fallback baseUrl when APP_URL is unset — covers || branch', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any);
    delete process.env.APP_URL;

    const res = await POST(jsonReq({ email: 'user@example.com' }));

    expect(res.status).toBe(200);
    // Restore for subsequent tests
    process.env.APP_URL = 'https://example.com';
    // send was still called (with the fallback lk.otsfera.ru URL in the email)
    expect(send).toHaveBeenCalled();
  });
});
