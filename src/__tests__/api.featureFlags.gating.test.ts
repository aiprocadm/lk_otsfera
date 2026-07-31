import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/partner/leads', () => ({
  listLeads: vi.fn(),
  createLead: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: vi.fn(),
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
  documentBucket: 'documents',
}));
vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { GET as pdfGet } from '@/app/api/partner/finance/statements/[id]/pdf/route';
import { GET as xlsxGet } from '@/app/api/partner/finance/statements/[id]/xlsx/route';
import { middleware } from '@/middleware';

const ORIGINAL_ENV = { ...process.env };

function middlewareReq(pathname: string) {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue({ value: 'tkn' }) }
  } as any;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Strip any pre-existing FEATURE_* so tests have a clean canvas.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_')) delete process.env[key];
  }
  vi.resetAllMocks();
  process.env.JWT_SECRET = 'middleware-chat-test-secret-at-least-32-chars!!';
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('api/partner/finance/statements/[id]/{pdf,xlsx} — commission_* gates', () => {
  it('PDF route returns 404 when FEATURE_COMMISSION_PDF=false', async () => {
    process.env.FEATURE_COMMISSION_PDF = 'false';
    const res = await pdfGet(new Request('http://t/'), {
      params: Promise.resolve({ id: 'stmt-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('XLSX route returns 404 when FEATURE_COMMISSION_XLSX=disabled', async () => {
    process.env.FEATURE_COMMISSION_XLSX = 'disabled';
    const res = await xlsxGet(new Request('http://t/'), {
      params: Promise.resolve({ id: 'stmt-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('PDF route does NOT short-circuit when its flag is unrelated (commission_xlsx=off)', async () => {
    // PDF should not care about XLSX flag — verifies gate is per-flag.
    process.env.FEATURE_COMMISSION_XLSX = '0';
    const { getSession } = await import('@/lib/auth/session');
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await pdfGet(new Request('http://t/'), {
      params: Promise.resolve({ id: 'stmt-1' }),
    });
    // Falls through to auth (no session → 401), proving gate didn't block.
    expect(res.status).toBe(401);
  });
});

describe('middleware feature-flag gate — chat (opt-in)', () => {
  it('returns 404 for /partner/messages when FEATURE_CHAT is unset (default off)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);
    // FEATURE_CHAT is not set (stripped in beforeEach) — opt-in defaults to disabled
    const res = await middleware(middlewareReq('/partner/messages'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('returns 404 for /partner/messages when FEATURE_CHAT=0', async () => {
    process.env.FEATURE_CHAT = '0';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);
    const res = await middleware(middlewareReq('/partner/messages'));
    expect(res.status).toBe(404);
  });

  it('does NOT 404 from the feature gate for /partner/messages when FEATURE_CHAT=1', async () => {
    process.env.FEATURE_CHAT = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);
    const res = await middleware(middlewareReq('/partner/messages'));
    // Gate passes — request continues (200 next() or redirect, but NOT a 404)
    expect(res.status).not.toBe(404);
  });

  it('returns 404 for /organization/messages when FEATURE_CHAT is unset', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'organization' } } as any);
    const res = await middleware(middlewareReq('/organization/messages'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('does NOT 404 from the feature gate for /organization/messages when FEATURE_CHAT=1 and FEATURE_ORGANIZATION_CABINET=1', async () => {
    process.env.FEATURE_CHAT = '1';
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'organization' } } as any);
    const res = await middleware(middlewareReq('/organization/messages'));
    expect(res.status).not.toBe(404);
  });
});
