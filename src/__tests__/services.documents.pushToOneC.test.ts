import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, enqueueDocumentPush, recordAudit } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  enqueueDocumentPush: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/oneCSync/pushDocument', () => ({ enqueueDocumentPush }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  oneCPushBlockReason,
  requestDocumentPush,
  requestDocumentPushMany,
} from '@/lib/services/documents/pushToOneC';

/**
 * `У-169` / `У-159` — кнопка «Выгрузить в 1С» и «Повторить».
 *
 * Сервис стоит МЕЖДУ человеком и очередью: права, видимость, правило
 * компании, «документ пришёл из 1С» — всё проверяется здесь, а не только
 * прячется на экране. Очередь мокается: её собственные проверки покрыты
 * тестами продюсера, тут важно, что до неё доходит только то, что должно.
 */

const staff = (role = 'manager'): SessionPayload =>
  ({ sub: 'u-staff', role, companyId: 'co-1' }) as unknown as SessionPayload;

const DOC = {
  id: 'doc-1',
  type: 'invoice',
  status: 'issued',
  number: 'С-2026-17',
  externalId: null,
  supersededAt: null,
  oneCPushStatus: 'none',
  companyId: 'co-1',
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  orderId: 'ord-1',
  order: { companyId: 'co-1' },
  company: {
    oneCDocumentPushMode: 'manual',
    oneCDocumentPushTypes: ['invoice', 'act', 'contract', 'extra_agreement'],
  },
};

function fake(docs: Array<Record<string, unknown>> | null = [{}]) {
  const byId = new Map(
    (docs ?? []).map((over, i) => {
      const d = { ...DOC, id: `doc-${i + 1}`, ...over };
      return [d.id, d];
    })
  );
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null);
  return { prisma: { document: { findUnique } } as unknown as PrismaClient, findUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
  enqueueDocumentPush.mockResolvedValue({ ok: true });
});

describe('oneCPushBlockReason — почему кнопки нет', () => {
  const company = DOC.company;

  it('счёт компании с правилом manual и своим набором типов — выгружать можно', () => {
    expect(
      oneCPushBlockReason({ type: 'invoice', externalId: null, supersededAt: null, company })
    ).toBeNull();
  });

  it('КП в 1С не выгружается никогда (Р-14) — раньше любых других причин', () => {
    expect(
      oneCPushBlockReason({
        type: 'commercial_proposal',
        externalId: 'from-1c',
        supersededAt: new Date(),
        company: { ...company, oneCDocumentPushMode: 'never' },
      })
    ).toBe('not_pushable_type');
  });

  it('документ, пришедший ИЗ 1С (externalId), обратно не возят', () => {
    expect(
      oneCPushBlockReason({ type: 'invoice', externalId: '1c-doc-7', supersededAt: null, company })
    ).toBe('from_1c');
  });

  it('правило компании never — выгрузка отключена и для кнопки', () => {
    expect(
      oneCPushBlockReason({
        type: 'invoice',
        externalId: null,
        supersededAt: null,
        company: { ...company, oneCDocumentPushMode: 'never' },
      })
    ).toBe('push_disabled');
  });

  it('тип снят с набора правила — ручная выгрузка тоже закрыта', () => {
    expect(
      oneCPushBlockReason({
        type: 'contract',
        externalId: null,
        supersededAt: null,
        company: { ...company, oneCDocumentPushTypes: ['invoice', 'act'] },
      })
    ).toBe('push_disabled');
  });

  it('заменённая версия не выгружается — в 1С едет действующая', () => {
    expect(
      oneCPushBlockReason({ type: 'act', externalId: null, supersededAt: new Date(), company })
    ).toBe('superseded');
  });
});

describe('requestDocumentPush', () => {
  it('ставит документ в очередь от имени сотрудника и пишет событие журнала', async () => {
    const { prisma } = fake();
    const res = await requestDocumentPush(prisma, staff(), 'doc-1');
    expect(res).toEqual({ ok: true, retry: false });
    expect(enqueueDocumentPush).toHaveBeenCalledWith(prisma, 'doc-1', { actorUserId: 'u-staff' });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'u-staff',
        action: 'document_push_to_1c_requested',
        entity: 'document',
        entityId: 'doc-1',
        after: expect.objectContaining({ retry: false, previousStatus: 'none' }),
      })
    );
  });

  it('«Повторить» после ошибки — та же дверь, но retry: true в журнале (У-159)', async () => {
    const { prisma } = fake([{ oneCPushStatus: 'failed' }]);
    const res = await requestDocumentPush(prisma, staff('leader'), 'doc-1');
    expect(res).toEqual({ ok: true, retry: true });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ after: expect.objectContaining({ retry: true }) })
    );
  });

  it('admin выгружает через зеркало /admin (Model A)', async () => {
    const { prisma } = fake();
    expect(await requestDocumentPush(prisma, staff('admin'), 'doc-1')).toEqual({
      ok: true,
      retry: false,
    });
  });

  it.each(['organization', 'partner'])('%s получает forbidden, база не читается', async (role) => {
    const { prisma, findUnique } = fake();
    expect(await requestDocumentPush(prisma, staff(role), 'doc-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('нет документа → not_found', async () => {
    const { prisma } = fake(null);
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('чужой документ (canReadDocument=false) → not_found, очередь не трогается', async () => {
    canReadDocument.mockResolvedValue(false);
    const { prisma } = fake();
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('запрашивает у базы type и status — их ждёт canReadDocument (У-164, страж read-fields)', async () => {
    const { prisma, findUnique } = fake();
    await requestDocumentPush(prisma, staff(), 'doc-1');
    const select = findUnique.mock.calls[0][0].select;
    expect(select).toMatchObject({ type: true, status: true });
    expect(canReadDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'doc-1', type: 'invoice', status: 'issued' })
    );
  });

  it('КП → not_pushable_type, в очередь не попадает', async () => {
    const { prisma } = fake([{ type: 'commercial_proposal' }]);
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_pushable_type',
    });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('документ из 1С → from_1c', async () => {
    const { prisma } = fake([{ externalId: '1c-doc-1' }]);
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'from_1c',
    });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('правило компании never → push_disabled: кнопка на экране правами не считается', async () => {
    const { prisma } = fake([{ company: { ...DOC.company, oneCDocumentPushMode: 'never' } }]);
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'push_disabled',
    });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('уже pending → already_queued без похода в очередь', async () => {
    const { prisma } = fake([{ oneCPushStatus: 'pending' }]);
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'already_queued',
    });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('очередь недоступна → её код наверх, события в журнале нет', async () => {
    enqueueDocumentPush.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    const { prisma } = fake();
    expect(await requestDocumentPush(prisma, staff(), 'doc-1')).toEqual({
      ok: false,
      error: 'queue_unavailable',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('requestDocumentPushMany — массовое действие списка', () => {
  it('считает поставленные и перечисляет пропущенные с причиной', async () => {
    const { prisma } = fake([
      {},
      { type: 'commercial_proposal' },
      { oneCPushStatus: 'pending' },
      { oneCPushStatus: 'failed' },
    ]);
    const res = await requestDocumentPushMany(prisma, staff(), [
      'doc-1',
      'doc-2',
      'doc-3',
      'doc-4',
      'doc-9',
    ]);
    expect(res).toEqual({
      ok: true,
      queued: 2,
      skipped: [
        { documentId: 'doc-2', error: 'not_pushable_type' },
        { documentId: 'doc-3', error: 'already_queued' },
        { documentId: 'doc-9', error: 'not_found' },
      ],
    });
    expect(enqueueDocumentPush).toHaveBeenCalledTimes(2);
  });

  it('повторы id схлопываются — один документ ставится один раз', async () => {
    const { prisma } = fake();
    const res = await requestDocumentPushMany(prisma, staff(), ['doc-1', 'doc-1']);
    expect(res).toEqual({ ok: true, queued: 1, skipped: [] });
    expect(enqueueDocumentPush).toHaveBeenCalledTimes(1);
  });

  it('не сотруднику — forbidden целиком, база не читается', async () => {
    const { prisma, findUnique } = fake();
    expect(await requestDocumentPushMany(prisma, staff('partner'), ['doc-1'])).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
