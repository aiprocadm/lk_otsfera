import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `У-251` — коды отказа замены версии превращаются в понятный ответ.
 *
 * Дверей загрузки пять, и каждая сама переводит код сервиса в HTTP (§3). Пока
 * перевода нет, отказ падает в «иное» и уезжает пятисотым: человек видит
 * «Произошла ошибка» вместо «у документа уже есть более новая версия» и жмёт
 * кнопку ещё раз. Поэтому проверяются все пять дверей и все три новых кода.
 *
 * `409` — состояние документа не допускает замены; `400` — прислали не тот
 * файл. Разные ответы потому, что и делать человеку надо разное: в первом
 * случае открыть последнюю версию, во втором — выбрать другой файл.
 */
const { getSession, redirectMock, svc } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  svc: {
    manager: vi.fn(),
    managerOrderLess: vi.fn(),
    organization: vi.fn(),
    partner: vi.fn(),
    admin: vi.fn(),
  },
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: () => null }));
vi.mock('@/lib/services/manager/uploads', () => ({
  createCounterpartyDocument: svc.manager,
  createManagerOrderLessDocument: svc.managerOrderLess,
}));
vi.mock('@/lib/services/organization/documentUpload', () => ({
  createOrganizationDocument: svc.organization,
}));
vi.mock('@/lib/services/partner/documentUpload', () => ({ createPartnerDocument: svc.partner }));
vi.mock('@/lib/services/documents/adminUpload', () => ({ uploadAdminDocument: svc.admin }));

import { POST as managerUpload } from '@/app/api/manager/documents/[id]/upload/route';
import { POST as managerOrderLess } from '@/app/api/manager/documents/order-less/route';
import { POST as organizationUpload } from '@/app/api/organization/documents/upload/route';
import { POST as partnerUpload } from '@/app/api/partner/documents/upload/route';
import { POST as adminUpload } from '@/app/api/documents/upload/route';

const pdf = () => new File(['x'], 'a.pdf', { type: 'application/pdf' });

function form(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set('file', pdf());
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('https://app.local/upload', { method: 'POST', body: fd });
}

const SESSIONS = {
  manager: { sub: 'm1', role: 'manager', email: 'm@l', companyId: 'co1', managedOrgIds: [] },
  organization: {
    sub: 'o1',
    role: 'organization',
    email: 'o@l',
    organizationId: 'org1',
    // Гард кабинета заказчика пускает по ДЕЙСТВУЮЩЕМУ членству, а не по роли.
    organizationMemberships: [{ organizationId: 'org1', isActive: true }],
  },
  partner: { sub: 'p1', role: 'partner', email: 'p@l', partnerId: 'ptr1' },
  admin: { sub: 'a1', role: 'admin', email: 'a@l' },
};

/** Каждая дверь: как её позвать и какой сервис она спрашивает. */
const DOORS = [
  {
    name: 'сотрудник, документ заказа',
    session: SESSIONS.manager,
    service: svc.manager,
    call: () =>
      managerUpload(form({ docType: 'act', replacesDocumentId: 'd1' }) as never, {
        params: Promise.resolve({ id: 'ord1' }),
      }),
  },
  {
    name: 'сотрудник, документ без заказа',
    session: SESSIONS.manager,
    service: svc.managerOrderLess,
    call: () =>
      managerOrderLess(
        form({
          counterpartyType: 'organization',
          counterpartyId: 'org1',
          docType: 'act',
          replacesDocumentId: 'd1',
        }) as never
      ),
  },
  {
    name: 'заказчик',
    session: SESSIONS.organization,
    service: svc.organization,
    call: () =>
      organizationUpload(
        form({ organizationId: 'org1', docType: 'act', replacesDocumentId: 'd1' }) as never
      ),
  },
  {
    name: 'партнёр',
    session: SESSIONS.partner,
    service: svc.partner,
    call: () => partnerUpload(form({ docType: 'act', replacesDocumentId: 'd1' }) as never),
  },
  {
    name: 'администратор',
    session: SESSIONS.admin,
    service: svc.admin,
    call: () => adminUpload(form({ orderId: 'ord1', replacesDocumentId: 'd1' }) as never),
  },
] as const;

describe('коды отказа замены версии в пяти дверях загрузки (У-251)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const door of DOORS) {
    it(`${door.name}: «уже есть новее» → 409`, async () => {
      getSession.mockResolvedValue(door.session);
      door.service.mockResolvedValue({ ok: false, error: 'already_superseded' });
      const res = await door.call();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'already_superseded' });
    });

    it(`${door.name}: «выпущен в ЛК» → 409`, async () => {
      getSession.mockResolvedValue(door.session);
      door.service.mockResolvedValue({ ok: false, error: 'generated_document' });
      const res = await door.call();
      expect(res.status).toBe(409);
    });

    it(`${door.name}: «не тот документ» → 400`, async () => {
      getSession.mockResolvedValue(door.session);
      door.service.mockResolvedValue({ ok: false, error: 'mismatch' });
      const res = await door.call();
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'mismatch' });
    });

    it(`${door.name}: идентификатор прежней версии доходит до сервиса`, async () => {
      getSession.mockResolvedValue(door.session);
      door.service.mockResolvedValue({ ok: false, error: 'mismatch' });
      await door.call();
      expect(door.service.mock.calls[0]?.[2]).toMatchObject({ replacesDocumentId: 'd1' });
    });
  }
});
