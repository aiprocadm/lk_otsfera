import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Этап 5 (ФТ-1.5): гейт создания партнёрских лидов при включённых заявках
 * клиентов. featureFlags НЕ мокается — флаг включается настоящим env
 * FEATURE_CLIENT_REQUESTS (opt-in), как в проде.
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/partner/leads', () => ({ listLeads: vi.fn(), createLead: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { listLeads, createLead } from '@/lib/services/partner/leads';
import { recordAudit } from '@/lib/auth/audit';
import { GET, POST } from '@/app/api/partner/leads/route';

const partner = { sub: 'u1', role: 'partner', partnerId: 'p1' } as never;

const VALID_PAYLOAD = {
  clientCompanyName: 'ООО Ромашка',
  clientContactName: 'Иван Иванов',
  subject: 'Обучение по охране труда'
};

const jsonReq = (b: unknown) =>
  new Request('http://x/api/partner/leads', {
    method: 'POST',
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' }
  });

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(partner);
  savedEnv.FEATURE_CLIENT_REQUESTS = process.env.FEATURE_CLIENT_REQUESTS;
  savedEnv.FEATURE_PARTNER_LEADS = process.env.FEATURE_PARTNER_LEADS;
  // partner_leads — opt-out (unset = включён); client_requests — opt-in (unset = выключен).
  delete process.env.FEATURE_CLIENT_REQUESTS;
  delete process.env.FEATURE_PARTNER_LEADS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Критерий приёмки этапа 5 (ФТ-1.5): при FEATURE_CLIENT_REQUESTS=1 партнёр НЕ создаёт лиды через API', () => {
  it('POST → 403 {error: forbidden}; createLead НЕ вызван, сессия даже не запрашивается', async () => {
    process.env.FEATURE_CLIENT_REQUESTS = '1';
    const res = await POST(jsonReq(VALID_PAYLOAD));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(vi.mocked(createLead)).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(getSession)).not.toHaveBeenCalled();
  });

  it('гейт закрывает только создание: GET (список лидов) при флаге on работает как раньше', async () => {
    process.env.FEATURE_CLIENT_REQUESTS = '1';
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} } as never);
    const res = await GET(new Request('http://x/api/partner/leads'));
    expect(res.status).toBe(200);
    expect(vi.mocked(listLeads)).toHaveBeenCalledWith({}, expect.objectContaining({ partnerId: 'p1' }));
  });

  it('при выключенном флаге (тёмный запуск) POST работает по-старому: 201 {id, status}', async () => {
    // FEATURE_CLIENT_REQUESTS не задан → opt-in флаг выключен → старое поведение.
    vi.mocked(createLead).mockResolvedValue({
      ok: true,
      lead: { id: 'L1', status: 'new', clientCompanyName: 'ООО Ромашка', subject: 'Обучение по охране труда' }
    } as never);
    const res = await POST(jsonReq(VALID_PAYLOAD));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'L1', status: 'new' });
    expect(vi.mocked(createLead)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        partnerId: 'p1',
        createdByUserId: 'u1',
        clientCompanyName: 'ООО Ромашка',
        subject: 'Обучение по охране труда'
      })
    );
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'lead_created', entityId: 'L1' })
    );
  });

  it('при выключенном флаге старая валидация тоже на месте: пустой payload → 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
    expect(vi.mocked(createLead)).not.toHaveBeenCalled();
  });

  it('явно выключенный флаг (FEATURE_CLIENT_REQUESTS=0) → тоже старое поведение', async () => {
    process.env.FEATURE_CLIENT_REQUESTS = '0';
    vi.mocked(createLead).mockResolvedValue({ ok: true, lead: { id: 'L2', status: 'new' } } as never);
    expect((await POST(jsonReq(VALID_PAYLOAD))).status).toBe(201);
  });
});
