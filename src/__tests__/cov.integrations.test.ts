/**
 * Track E / E1 — coverage restoration for the integrations domain
 * (Max / Telegram / WhatsApp link + client + webhook routes).
 *
 * Unit-tier (no real Prisma client is constructed): every DB touch is a minimal
 * stub prisma or a mocked service; every transport (fetch) is stubbed. Mirrors the
 * mocks of max.client.test / telegram.client.test / whatsapp.aggregator.test /
 * api.integrations.max.webhook.test / api.telegram.webhook.test.
 *
 * Targets ONLY the residual uncovered branches/lines:
 *   - lib/max/client.ts        branch @ 58  (res.ok === false)
 *   - lib/telegram/client.ts   branches @ 11 (no username), 20 (no token), 37 (res.ok false)
 *   - lib/whatsapp/aggregator.ts branch @ 65 (res.ok === false)
 *   - lib/services/max/link.ts      lines 107-112 / branch @ 106 (P2002 catch)
 *   - lib/services/telegram/link.ts lines 104-109 / branch @ 103 (P2002 catch)
 *   - app/api/integrations/max/webhook/route.ts      line 66 / branch @ 65 (payload non-string)
 *   - app/api/integrations/telegram/webhook/route.ts line 48 / branch @ 46 (linkByCode throws)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// featureFlags is imported by max/client.ts (isFeatureEnabled) AND by the max
// webhook route (notFoundIfDisabled). ONE module mock must export both, since
// vi.mock is file-scoped. (Mirrors max.client.test + api.integrations.max.webhook.test.)
// ---------------------------------------------------------------------------
const { isFeatureEnabled, notFoundIfDisabled } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(() => true),
  notFoundIfDisabled: vi.fn(() => null),
}));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled, notFoundIfDisabled }));

// ---------------------------------------------------------------------------
// Section 1 — transport clients: uncovered false/fallback branches
// ---------------------------------------------------------------------------
import { sendMaxMessage } from '@/lib/max/client';
import { botDeepLink, sendTelegramMessage } from '@/lib/telegram/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';

const CLIENT_ENV = [
  'MAX_BOT_TOKEN',
  'MAX_API_BASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'WHATSAPP_AGGREGATOR_API_KEY',
  'WHATSAPP_AGGREGATOR_CHANNEL_ID',
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('transport clients — residual false-branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    for (const k of CLIENT_ENV) savedEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of CLIENT_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
  });

  // max/client.ts branch @ 58: `return { ok: res.ok }` with res.ok === false.
  it('sendMaxMessage: {ok:false} когда fetch отдаёт не-2xx (res.ok=false)', async () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendMaxMessage('chat-x', 'hi')).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // telegram/client.ts branch @ 11: `?? ''` fallback when username env absent.
  it('botDeepLink: пустой username (env отсутствует) → t.me/ без имени', () => {
    delete process.env.TELEGRAM_BOT_USERNAME;
    expect(botDeepLink('abc123')).toBe('https://t.me/?start=abc123');
  });

  // telegram/client.ts branch @ 20: `if (!token) return { ok: false }` (no token).
  it('sendTelegramMessage: no-op {ok:false} без токена, fetch не вызывается', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendTelegramMessage('c1', 'hi')).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // telegram/client.ts branch @ 37: `return { ok: res.ok }` with res.ok === false.
  it('sendTelegramMessage: {ok:false} на не-2xx ответе (res.ok=false)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendTelegramMessage('c1', 'hi')).toEqual({ ok: false });
  });

  // whatsapp/aggregator.ts branch @ 65: `return { ok: res.ok }` with res.ok === false.
  it('sendWhatsAppMessage: {ok:false} на не-2xx ответе агрегатора (res.ok=false)', async () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch1';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendWhatsAppMessage('+79991234567', 'hi')).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Section 2 — link services: P2002 race catch-block.
//
// The pre-check findUnique passes (chatId free), but the update collides on the
// @unique constraint — a real concurrent-write race. Faithfully simulated with a
// stub prisma whose update() throws. Both sub-branches of the `?? .code === P2002`
// guard are covered: P2002 → chat_taken; non-P2002 → rethrow.
// ---------------------------------------------------------------------------
// NOTE: `@/lib/services/max/link` and `@/lib/services/telegram/link` are mocked
// further down (for the webhook route sections). Section 2 needs the REAL impls,
// so it pulls them via vi.importActual — bypassing the file-scoped mock.
import type { PrismaClient } from '@prisma/client';

async function realMaxLink() {
  return vi.importActual<typeof import('@/lib/services/max/link')>('@/lib/services/max/link');
}
async function realTelegramLink() {
  return vi.importActual<typeof import('@/lib/services/telegram/link')>(
    '@/lib/services/telegram/link'
  );
}

type StubOpts = {
  linkedUserId: string;
  chatOwner?: { id: string } | null; // findUnique(maxChatId/telegramChatId) result
  updateError?: unknown; // if set, update() rejects with this
};

function stubPrisma(opts: StubOpts): PrismaClient {
  const update = opts.updateError
    ? vi.fn().mockRejectedValue(opts.updateError)
    : vi.fn().mockResolvedValue({ id: opts.linkedUserId });
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: opts.linkedUserId }),
      findUnique: vi.fn().mockResolvedValue(opts.chatOwner ?? null),
      update,
    },
    // recordAudit is never reached in the P2002 path, but present for the
    // rethrow-after-success guard shape parity.
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

const P2002 = { code: 'P2002', clientVersion: 'x' };

describe('linkMaxByCode — P2002 race on update (branch @ 106, lines 107-112)', () => {
  it('P2002 при update → chat_taken (race: pre-check прошёл, запись столкнулась)', async () => {
    const { linkMaxByCode } = await realMaxLink();
    const prisma = stubPrisma({ linkedUserId: 'u-1', chatOwner: null, updateError: P2002 });
    const result = await linkMaxByCode(prisma, { code: 'valid', chatId: 'raced-chat' });
    expect(result).toEqual({ ok: false, error: 'chat_taken' });
  });

  it('не-P2002 ошибка update → пробрасывается (throw err, не проглатывается)', async () => {
    const { linkMaxByCode } = await realMaxLink();
    const boom = Object.assign(new Error('db exploded'), { code: 'P1001' });
    const prisma = stubPrisma({ linkedUserId: 'u-1', chatOwner: null, updateError: boom });
    await expect(linkMaxByCode(prisma, { code: 'valid', chatId: 'c' })).rejects.toThrow(
      'db exploded'
    );
  });
});

describe('linkByCode (telegram) — P2002 race on update (branch @ 103, lines 104-109)', () => {
  it('P2002 при update → chat_taken', async () => {
    const { linkByCode } = await realTelegramLink();
    const prisma = stubPrisma({ linkedUserId: 'u-2', chatOwner: null, updateError: P2002 });
    const result = await linkByCode(prisma, { code: 'valid', chatId: 'raced-chat' });
    expect(result).toEqual({ ok: false, error: 'chat_taken' });
  });

  it('не-P2002 ошибка update → пробрасывается', async () => {
    const { linkByCode } = await realTelegramLink();
    const boom = Object.assign(new Error('db exploded'), { code: 'P1001' });
    const prisma = stubPrisma({ linkedUserId: 'u-2', chatOwner: null, updateError: boom });
    await expect(linkByCode(prisma, { code: 'valid', chatId: 'c' })).rejects.toThrow('db exploded');
  });
});

// ---------------------------------------------------------------------------
// Section 3 — Max webhook route: extractStart falls through to `: null`
// (line 66 / branch @ 65) when neither message.text nor bot_started.payload is a
// string. Mirrors api.integrations.max.webhook.test mocks.
// ---------------------------------------------------------------------------
// The webhook route needs linkMaxByCode injectable (to assert it is NOT called
// on the fall-through path). Mock ONLY that export via importOriginal-spread so
// Section 2's importActual still yields the real impl and coverage is recorded.
// The transports (sendMaxMessage / sendTelegramMessage) are left REAL: the
// fall-through / throw paths never reach them, and no bot token is set so no
// network fires — so no client mock is needed (and Section 1 keeps the real ones).
const { linkMaxByCodeWh } = vi.hoisted(() => ({ linkMaxByCodeWh: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/max/link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/max/link')>();
  return { ...actual, linkMaxByCode: linkMaxByCodeWh };
});

const MAX_SECRET = 'max-secret-32-chars-xxxxxxxxxxxxx';

function maxReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.local/api/integrations/max/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/integrations/max/webhook — extractStart fall-through', () => {
  let POST_MAX: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    notFoundIfDisabled.mockReturnValue(null); // флаг max_channel включён
    process.env.MAX_WEBHOOK_SECRET = MAX_SECRET;
    ({ POST: POST_MAX } = await import('@/app/api/integrations/max/webhook/route'));
  });

  afterEach(() => {
    delete process.env.MAX_WEBHOOK_SECRET;
  });

  // branch @ 65 false side + line 66 (`: null`): bot_started present but payload
  // is NOT a string (number), and no message.text → text resolves to null → no-op.
  it('200 no-op когда bot_started.payload не строка (number) → text=null (line 66)', async () => {
    const res = await POST_MAX(
      maxReq(
        { bot_started: { payload: 12345, user_id: 7 } },
        { 'x-max-webhook-secret': MAX_SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCodeWh).not.toHaveBeenCalled();
  });

  it('200 no-op когда апдейт без message и без bot_started (оба undefined) → text=null', async () => {
    const res = await POST_MAX(
      maxReq({ callback: { foo: 'bar' } }, { 'x-max-webhook-secret': MAX_SECRET })
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCodeWh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 4 — Telegram webhook route: linkByCode throws → swallowed catch,
// still 200 (line 48 / branch @ 46). Mirrors api.telegram.webhook.test mocks.
// ---------------------------------------------------------------------------
// Mock ONLY linkByCode (to force it to throw). sendTelegramMessage stays REAL:
// the throw happens before it is reached, and no token is set, so no network.
const { linkByCodeWh } = vi.hoisted(() => ({ linkByCodeWh: vi.fn() }));
vi.mock('@/lib/services/telegram/link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/telegram/link')>();
  return { ...actual, linkByCode: linkByCodeWh };
});

const TG_SECRET = 'test-secret-token-32-chars-long!!';

function tgReq(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-telegram-bot-api-secret-token'] = secret;
  return new Request('https://app.local/api/integrations/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/integrations/telegram/webhook — linkByCode throws (branch @ 46, line 48)', () => {
  let POST_TG: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = TG_SECRET;
    ({ POST: POST_TG } = await import('@/app/api/integrations/telegram/webhook/route'));
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('ошибка linkByCode не превращается в 500 — 200, catch проглатывает', async () => {
    linkByCodeWh.mockRejectedValue(new Error('db down'));
    const res = await POST_TG(
      tgReq({ message: { text: '/start CODE', chat: { id: 42 } } }, TG_SECRET)
    );
    expect(res.status).toBe(200);
    // linkByCode threw before sendTelegramMessage — the catch at line 46 swallowed
    // it and the handler still returned 200 (no retry-storm).
    expect(linkByCodeWh).toHaveBeenCalledWith({}, { code: 'CODE', chatId: '42' });
  });
});
