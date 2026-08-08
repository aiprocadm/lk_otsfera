/**
 * Добор покрытия группы «misc-api» — ветки, до которых не доходили
 * существующие наборы. Каждый тест проверяет ПОВЕДЕНИЕ роута (что уходит в
 * сервис / какой статус и тело возвращается), а не «дёргает строку ради
 * процента».
 *
 * Закрываются:
 *  - `POST /api/admin/order-statuses` — плечо `isTerminal !== undefined`
 *    (терминальный статус доезжает до сервиса);
 *  - `POST /api/integrations/whatsapp/webhook` — плечо `m.name !== undefined`
 *    (имя контакта из Wazzup доезжает как `senderDisplay`);
 *  - `PATCH /api/enrollments/[id]` — 400 на нечитаемом теле (ветка
 *    `!parsed.ok`) и маппинг ошибки сервиса при `action: 'reject'`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- общие моки на все три роута файла ---------------------------------
const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// order-statuses: гарды и сервис справочника
const { requireSession, requireFieldsAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireFieldsAdmin: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireFieldsAdmin }));

const { createStatusDefinition } = vi.hoisted(() => ({ createStatusDefinition: vi.fn() }));
vi.mock('@/lib/services/orderStatuses', () => ({ createStatusDefinition }));

// whatsapp webhook: ingest и диагностика
const { ingest, recordWebhookEvent } = vi.hoisted(() => ({
  ingest: vi.fn(),
  recordWebhookEvent: vi.fn(),
}));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingest }));
vi.mock('@/lib/services/admin/webhookDiagnostics', () => ({ recordWebhookEvent }));

// enrollments: сессия и жизненный цикл заявки
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { approveEnrollment, rejectEnrollment, markProvisioned, advanceEnrollmentItems } = vi.hoisted(
  () => ({
    approveEnrollment: vi.fn(),
    rejectEnrollment: vi.fn(),
    markProvisioned: vi.fn(),
    advanceEnrollmentItems: vi.fn(),
  })
);
vi.mock('@/lib/services/enrollments/lifecycle', () => ({
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
  advanceEnrollmentItems,
}));

import { POST as createOrderStatus } from '@/app/api/admin/order-statuses/route';
import { POST as whatsappWebhook } from '@/app/api/integrations/whatsapp/webhook/route';
import { PATCH as patchEnrollment } from '@/app/api/enrollments/[id]/route';

const ADMIN = { sub: 'a1', role: 'admin' };
const MANAGER = { sub: 'm1', role: 'manager' };
const WA_SECRET = 'wazzup-secret-32-chars-xxxxxxxxxxxxx';

const routeCtx = { params: Promise.resolve({}) };
const enrollmentCtx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  requireSession.mockResolvedValue({ ok: true, value: ADMIN });
  requireFieldsAdmin.mockReturnValue({ ok: true, value: ADMIN });
  recordWebhookEvent.mockResolvedValue(undefined);
  process.env.WHATSAPP_WEBHOOK_SECRET = WA_SECRET;
});

afterEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_SECRET;
});

describe('POST /api/admin/order-statuses — терминальный статус', () => {
  it('isTerminal из тела доезжает до сервиса (не отбрасывается схемой)', async () => {
    createStatusDefinition.mockResolvedValue({
      ok: true,
      definition: { id: 'st10', key: 'closed', isTerminal: true },
    });
    const res = await createOrderStatus(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ key: 'closed', label: 'Закрыт', isTerminal: true }),
      }),
      routeCtx
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      definition: { id: 'st10', key: 'closed', isTerminal: true },
    });
    expect(createStatusDefinition).toHaveBeenCalledWith(
      {},
      ADMIN,
      expect.objectContaining({ key: 'closed', label: 'Закрыт', isTerminal: true })
    );
  });
});

describe('POST /api/integrations/whatsapp/webhook — имя контакта', () => {
  it('contact.name уходит в ingest как senderDisplay', async () => {
    ingest.mockResolvedValue({ ok: true, id: 'msg1', deduped: false });
    const res = await whatsappWebhook(
      new Request('https://app.local/api/integrations/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wazzup-secret': WA_SECRET },
        body: JSON.stringify({
          messages: [
            {
              messageId: 'W9',
              chatId: '79990001199',
              text: 'добрый день',
              contact: { name: 'Иван Петров' },
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        channel: 'whatsapp',
        externalId: 'wa:W9',
        senderRef: '+79990001199',
        senderDisplay: 'Иван Петров',
        body: 'добрый день',
      })
    );
  });
});

describe('PATCH /api/enrollments/[id] — нечитаемое тело и отказ по reject', () => {
  it('тело не JSON → 400 invalid_request, ни один сервис не вызван', async () => {
    getSession.mockResolvedValue(MANAGER);
    const res = await patchEnrollment(
      new Request('http://x/', {
        method: 'PATCH',
        body: 'не-json',
        headers: { 'content-type': 'text/plain' },
      }),
      enrollmentCtx('E1')
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(approveEnrollment).not.toHaveBeenCalled();
    expect(rejectEnrollment).not.toHaveBeenCalled();
    expect(markProvisioned).not.toHaveBeenCalled();
    expect(advanceEnrollmentItems).not.toHaveBeenCalled();
  });

  it('reject несуществующей заявки → 404 с кодом сервиса', async () => {
    getSession.mockResolvedValue(MANAGER);
    rejectEnrollment.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await patchEnrollment(
      new Request('http://x/', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject', reason: 'дубль' }),
        headers: { 'content-type': 'application/json' },
      }),
      enrollmentCtx('missing')
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(rejectEnrollment).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: 'missing', reviewerId: 'm1', reason: 'дубль' })
    );
  });

  it('reject уже обработанной заявки → 409 lifecycle_violation', async () => {
    getSession.mockResolvedValue(MANAGER);
    rejectEnrollment.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await patchEnrollment(
      new Request('http://x/', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject', reason: 'поздно' }),
        headers: { 'content-type': 'application/json' },
      }),
      enrollmentCtx('E1')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });
});
