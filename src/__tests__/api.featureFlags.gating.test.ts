import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/partner/leads', () => ({
  listLeads: vi.fn(),
  createLead: vi.fn(),
}));
vi.mock('@/lib/storage/supabase', () => ({
  getServerClient: () => ({ storage: { from: () => ({ createSignedUrl: vi.fn() }) } }),
  documentBucket: 'documents',
}));

import { GET as leadsGet, POST as leadsPost } from '@/app/api/partner/leads/route';
import { GET as pdfGet } from '@/app/api/partner/finance/statements/[id]/pdf/route';
import { GET as xlsxGet } from '@/app/api/partner/finance/statements/[id]/xlsx/route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Strip any pre-existing FEATURE_* so tests have a clean canvas.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_')) delete process.env[key];
  }
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('api/partner/leads — partner_leads gate', () => {
  it('GET returns 404 (text Not Found) when FEATURE_PARTNER_LEADS=0', async () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    const res = await leadsGet(new Request('http://t/api/partner/leads'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  it('POST returns 404 when FEATURE_PARTNER_LEADS=off', async () => {
    process.env.FEATURE_PARTNER_LEADS = 'off';
    const res = await leadsPost(
      new Request('http://t/api/partner/leads', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(404);
  });
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
