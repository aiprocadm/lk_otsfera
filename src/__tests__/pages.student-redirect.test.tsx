// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { signStudentBridgeToken } = vi.hoisted(() => ({ signStudentBridgeToken: vi.fn() }));
vi.mock('@/lib/auth/jwt', () => ({ signStudentBridgeToken }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { assertAllowedStudentPortalUrl } = vi.hoisted(() => ({
  assertAllowedStudentPortalUrl: vi.fn()
}));
vi.mock('@/lib/security/redirect', () => ({ assertAllowedStudentPortalUrl }));

type TxMock = { studentBridgeGrant: { create: ReturnType<typeof vi.fn> } };
const { txMock, prismaTransaction, studentBridgeGrantCreate } = vi.hoisted(() => {
  const studentBridgeGrantCreate = vi.fn().mockResolvedValue({});
  const tx: TxMock = { studentBridgeGrant: { create: studentBridgeGrantCreate } };
  const prismaTransaction = vi.fn((cb: (tx: TxMock) => Promise<unknown>) => cb(tx));
  return { txMock: tx, prismaTransaction, studentBridgeGrantCreate };
});
vi.mock('@/lib/db/prisma', () => ({ prisma: { $transaction: prismaTransaction } }));

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  })
}));
vi.mock('next/navigation', () => nav);

import StudentRedirectPage from '@/app/student/redirect/page';

const ENV_KEYS = [
  'STUDENT_REDIRECT_URL',
  'STUDENT_PORTAL_URL',
  'STUDENT_REDIRECT_ALLOWED_DOMAINS',
  'STUDENT_PORTAL_ALLOWED_HOSTS',
  'STUDENT_BRIDGE_CODE_TTL_SEC'
] as const;

describe('StudentRedirectPage', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    getSession.mockReset();
    signStudentBridgeToken.mockReset();
    recordAudit.mockReset();
    assertAllowedStudentPortalUrl.mockReset();
    prismaTransaction.mockClear();
    studentBridgeGrantCreate.mockClear();
    nav.redirect.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  it('renders nothing (null) when there is no session', async () => {
    getSession.mockResolvedValue(null);

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toBe('');
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it('shows an access-denied message for a non-student session (defense-in-depth)', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'organization' });

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toContain('доступен только обучающимся');
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it('shows a config-missing message when STUDENT_REDIRECT_URL is unset', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toContain('STUDENT_REDIRECT_URL не настроен');
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it('falls back to the legacy STUDENT_PORTAL_URL env var and warns about deprecation', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_PORTAL_URL = 'https://otsfera.cdoprof.com/legacy';
    assertAllowedStudentPortalUrl.mockImplementation((url: string) => new URL(url));
    signStudentBridgeToken.mockResolvedValue({ token: 'tok', jti: 'jti-1', iat: 1000 });

    await expect(renderServerComponent(StudentRedirectPage())).rejects.toThrow(
      'REDIRECT:https://otsfera.cdoprof.com/legacy?code='
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('STUDENT_PORTAL_URL is deprecated')
    );
  });

  it('shows a blocked-URL error message when the URL fails allowlist/protocol validation (parseable URL)', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'https://evil.example.com/portal';
    assertAllowedStudentPortalUrl.mockImplementation(() => {
      throw new Error('Student portal URL hostname is not allowlisted.');
    });

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toContain('Не удалось выполнить безопасный переход');
    expect(console.error).toHaveBeenCalledWith(
      'Blocked student portal redirect URL',
      expect.objectContaining({ hostname: 'evil.example.com', protocol: 'https:' })
    );
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it('logs "Unknown error" when the validator throws a non-Error value', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'https://otsfera.cdoprof.com/sso';
    assertAllowedStudentPortalUrl.mockImplementation(() => {
      // Exercises the `error instanceof Error` fallback branch: the page
      // must handle non-Error throws too.
      throw 'plain string rejection';
    });

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toContain('Не удалось выполнить безопасный переход');
    expect(console.error).toHaveBeenCalledWith(
      'Blocked student portal redirect URL',
      expect.objectContaining({ reason: 'Unknown error' })
    );
  });

  it('shows a blocked-URL error message when the configured URL is not even parseable', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'not a url';
    assertAllowedStudentPortalUrl.mockImplementation(() => {
      throw new Error('Invalid URL');
    });

    const { container } = await renderServerComponent(StudentRedirectPage());

    expect(container.textContent).toContain('Не удалось выполнить безопасный переход');
    expect(console.error).toHaveBeenCalledWith(
      'Blocked student portal redirect URL',
      expect.objectContaining({ hostname: undefined, protocol: undefined })
    );
  });

  it('mints a bridge token, records audit, persists the grant, and redirects with a one-time code (happy path)', async () => {
    getSession.mockResolvedValue({
      sub: 'u1',
      role: 'student',
      organizationId: 'org-1',
      email: 'stud@example.com',
      name: 'Студент Студентов',
      externalStudentId: 'ext-1'
    });
    process.env.STUDENT_REDIRECT_URL = 'https://otsfera.cdoprof.com/sso';
    process.env.STUDENT_REDIRECT_ALLOWED_DOMAINS = 'extra.example.com';
    process.env.STUDENT_BRIDGE_CODE_TTL_SEC = '120';
    assertAllowedStudentPortalUrl.mockImplementation((url: string) => new URL(url));
    signStudentBridgeToken.mockResolvedValue({ token: 'signed-token', jti: 'jti-42', iat: 12345 });

    await expect(renderServerComponent(StudentRedirectPage())).rejects.toThrow(/^REDIRECT:/);

    expect(signStudentBridgeToken).toHaveBeenCalledWith({
      sub: 'u1',
      role: 'student',
      organizationId: 'org-1',
      email: 'stud@example.com',
      name: 'Студент Студентов',
      externalStudentId: 'ext-1'
    });
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenNthCalledWith(
      1,
      txMock,
      expect.objectContaining({ action: 'STUDENT_BRIDGE_TOKEN_ISSUED', entityId: 'jti-42' })
    );
    expect(recordAudit).toHaveBeenNthCalledWith(
      2,
      txMock,
      expect.objectContaining({ action: 'STUDENT_BRIDGE_CODE_ISSUED', entityId: 'jti-42' })
    );
    // SECURITY (CLAUDE.md §12): the one-time code itself must never be logged/audited.
    const secondCallAfter = recordAudit.mock.calls[1]![1].after as Record<string, unknown>;
    expect(JSON.stringify(secondCallAfter)).not.toContain('code');
    expect(studentBridgeGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ jti: 'jti-42', token: 'signed-token', userId: 'u1' })
    });

    const redirectedUrl = nav.redirect.mock.calls[0]![0] as string;
    expect(redirectedUrl).toMatch(/^https:\/\/otsfera\.cdoprof\.com\/sso\?code=[0-9a-f-]{36}$/);
  });

  it('falls back to the legacy STUDENT_PORTAL_ALLOWED_HOSTS allowlist env var and warns about deprecation', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'https://otsfera.cdoprof.com/sso';
    process.env.STUDENT_PORTAL_ALLOWED_HOSTS = 'legacy.example.com';
    assertAllowedStudentPortalUrl.mockImplementation((url: string) => new URL(url));
    signStudentBridgeToken.mockResolvedValue({ token: 'tok', jti: 'jti-legacy', iat: 1 });

    await expect(renderServerComponent(StudentRedirectPage())).rejects.toThrow(/^REDIRECT:/);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('STUDENT_PORTAL_ALLOWED_HOSTS is deprecated')
    );
    expect(assertAllowedStudentPortalUrl).toHaveBeenCalledWith(
      'https://otsfera.cdoprof.com/sso',
      { allowlist: ['otsfera.cdoprof.com', 'legacy.example.com'] }
    );
  });

  it('defaults codeTtlSec to 60s when STUDENT_BRIDGE_CODE_TTL_SEC is not a finite number (module-load-time NaN)', async () => {
    process.env.STUDENT_BRIDGE_CODE_TTL_SEC = 'not-a-number';
    vi.resetModules();
    const { default: FreshStudentRedirectPage } = await import('@/app/student/redirect/page');

    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'https://otsfera.cdoprof.com/sso';
    assertAllowedStudentPortalUrl.mockImplementation((url: string) => new URL(url));
    signStudentBridgeToken.mockResolvedValue({ token: 't', jti: 'jti-nan', iat: 1 });

    await expect(renderServerComponent(FreshStudentRedirectPage())).rejects.toThrow(/^REDIRECT:/);

    const grantArgs = studentBridgeGrantCreate.mock.calls[0]![0] as { data: { expiresAt: Date } };
    const ttlSec = (grantArgs.data.expiresAt.getTime() - Date.now()) / 1000;
    expect(ttlSec).toBeGreaterThan(55);
    expect(ttlSec).toBeLessThanOrEqual(60.5);
  });

  it('clamps an out-of-range STUDENT_BRIDGE_CODE_TTL_SEC (e.g. negative) to the floor', async () => {
    // bridgeCodeTtlSec is read from process.env at MODULE LOAD time (top-level
    // const), not per-request — so the env var must be set BEFORE the page
    // module is imported. vi.resetModules() + a fresh dynamic import is the
    // only way to exercise a non-default value here.
    process.env.STUDENT_BRIDGE_CODE_TTL_SEC = '-5';
    vi.resetModules();
    const { default: FreshStudentRedirectPage } = await import('@/app/student/redirect/page');

    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    process.env.STUDENT_REDIRECT_URL = 'https://otsfera.cdoprof.com/sso';
    assertAllowedStudentPortalUrl.mockImplementation((url: string) => new URL(url));
    signStudentBridgeToken.mockResolvedValue({ token: 't', jti: 'jti-7', iat: 1 });

    await expect(renderServerComponent(FreshStudentRedirectPage())).rejects.toThrow(/^REDIRECT:/);

    const grantArgs = studentBridgeGrantCreate.mock.calls[0]![0] as { data: { expiresAt: Date } };
    const ttlSec = (grantArgs.data.expiresAt.getTime() - Date.now()) / 1000;
    expect(ttlSec).toBeGreaterThan(5);
    expect(ttlSec).toBeLessThanOrEqual(10.5);
  });
});
