import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeMangoSign } from '@/lib/telephony/mango/sign';

const { ingestCallEvent, getQueue, addMock } = vi.hoisted(() => {
  const addMock = vi.fn().mockResolvedValue(undefined);
  return {
    ingestCallEvent: vi.fn(),
    getQueue: vi.fn().mockReturnValue({ add: addMock }),
    addMock,
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/telephony/ingestCall', () => ({ ingestCallEvent }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { POST } from '@/app/api/integrations/mango/webhook/route';

const API_KEY = 'mango-api-key';
const SALT = 'mango-salt';
const ALLOWED_IP = '81.88.80.132';

function req(url: string, json: string, opts: { sign?: string; ip?: string } = {}): Request {
  const sign = opts.sign ?? computeMangoSign(API_KEY, json, SALT);
  const ip = opts.ip ?? ALLOWED_IP;
  return new Request(url, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: new URLSearchParams({ json, sign }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_TELEPHONY_MANGO = '1';
  process.env.MANGO_API_KEY = API_KEY;
  process.env.MANGO_API_SALT = SALT;
  process.env.MANGO_ALLOWED_IPS = ALLOWED_IP;
});

afterEach(() => {
  delete process.env.FEATURE_TELEPHONY_MANGO;
  delete process.env.MANGO_API_KEY;
  delete process.env.MANGO_API_SALT;
  delete process.env.MANGO_ALLOWED_IPS;
});

describe('POST /api/integrations/mango/webhook', () => {
  it('404 когда флаг telephony_mango выключен (ingest не вызывается)', async () => {
    process.env.FEATURE_TELEPHONY_MANGO = '0';
    const json = JSON.stringify({ entry_id: 'e1' });
    const res = await POST(req('https://app.local/api/integrations/mango/webhook?type=summary', json));
    expect(res.status).toBe(404);
    expect(ingestCallEvent).not.toHaveBeenCalled();
  });

  it('401 при недопустимом IP (x-forwarded-for не в allowlist), sign не проверяется', async () => {
    const json = JSON.stringify({ entry_id: 'e1' });
    const res = await POST(
      req('https://app.local/api/integrations/mango/webhook?type=summary', json, { ip: '1.2.3.4' })
    );
    expect(res.status).toBe(401);
    expect(ingestCallEvent).not.toHaveBeenCalled();
  });

  it('401 при валидном IP, но НЕВЕРНОЙ подписи', async () => {
    const json = JSON.stringify({ entry_id: 'e1' });
    const res = await POST(
      req('https://app.local/api/integrations/mango/webhook?type=summary', json, { sign: 'wrong-sign' })
    );
    expect(res.status).toBe(401);
    expect(ingestCallEvent).not.toHaveBeenCalled();
  });

  it('401 когда MANGO_API_KEY/SALT не сконфигурированы', async () => {
    delete process.env.MANGO_API_KEY;
    delete process.env.MANGO_API_SALT;
    const json = JSON.stringify({ entry_id: 'e1' });
    const res = await POST(req('https://app.local/api/integrations/mango/webhook?type=summary', json));
    expect(res.status).toBe(401);
    expect(ingestCallEvent).not.toHaveBeenCalled();
  });

  it('валидный IP + валидная подпись, ?type=summary с валидным payload → ingestCallEvent вызван, 200', async () => {
    ingestCallEvent.mockResolvedValue({ ok: true, id: 'call1' });
    const json = JSON.stringify({
      entry_id: 'e1',
      from: { number: '79990001122' },
      to: { number: '100' },
      call_direction: 1,
      duration: 42,
      status: 'Answered',
    });
    const res = await POST(req('https://app.local/api/integrations/mango/webhook?type=summary', json));
    expect(res.status).toBe(200);
    expect(ingestCallEvent).toHaveBeenCalledTimes(1);
    expect(ingestCallEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'summary', externalId: 'e1' })
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it('без ?type события трактуются как summary (дефолт ?? "summary")', async () => {
    ingestCallEvent.mockResolvedValue({ ok: true, id: 'call1' });
    const json = JSON.stringify({
      entry_id: 'e-default',
      from: { number: '79990001122' },
      to: { number: '100' },
      call_direction: 1,
      duration: 10,
      status: 'Answered',
    });
    const res = await POST(req('https://app.local/api/integrations/mango/webhook', json));
    expect(res.status).toBe(200);
    expect(ingestCallEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'summary', externalId: 'e-default' })
    );
  });

  it('валидный ?type=recording (recording_state=Completed + recording_id) → ingestCallEvent И enqueue вызваны, 200', async () => {
    ingestCallEvent.mockResolvedValue({ ok: true, id: 'call1', needsRecording: true });
    const json = JSON.stringify({
      entry_id: 'e2',
      recording_state: 'Completed',
      recording_id: 'rec-123',
    });
    const res = await POST(req('https://app.local/api/integrations/mango/webhook?type=recording', json));
    expect(res.status).toBe(200);
    expect(ingestCallEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'recording', externalId: 'e2', recordingId: 'rec-123' })
    );
    expect(getQueue).toHaveBeenCalledWith('telephony.mango.recording');
    expect(addMock).toHaveBeenCalledWith('rec', { externalId: 'e2', recordingId: 'rec-123' });
  });

  it('malformed JSON тело (но валидная подпись над этой строкой) → 200, ingest не вызывается', async () => {
    const json = '{ not valid json';
    const res = await POST(req('https://app.local/api/integrations/mango/webhook?type=summary', json));
    expect(res.status).toBe(200);
    expect(ingestCallEvent).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });
});
