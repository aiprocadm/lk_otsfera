/**
 * `У-251` — отказ в замене версии доходит до человека нетронутым.
 *
 * Правило замены одно на все каналы загрузки (`resolveReplaces`), но вернуть
 * его код обязан каждый из них. Канал, который проглотит отказ и запишет файл
 * как новую бумагу, ничего не сломает заметно — просто в шкафу появится второй
 * документ рядом с первым, ровно та беда, от которой этап и уходит. Поэтому
 * здесь проверяются ВСЕ каналы и обе их ветки: с заказом и без.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { core, resolveReplaces } = vi.hoisted(() => ({
  core: vi.fn(),
  resolveReplaces: vi.fn(),
}));
vi.mock('@/lib/services/documents/upload-core', () => ({
  persistUploadedDocument: core,
  validateUploadFile: () => ({ ok: true }),
}));
vi.mock('@/lib/services/documents/versions', () => ({ resolveReplaces }));
vi.mock('@/lib/notifications', () => ({
  notifyManagers: vi.fn(),
  notifyManagersOrderLess: vi.fn(),
  notifyManagersPartnerOrderLess: vi.fn(),
  notifyOrgUsers: vi.fn(),
  notifyPartnerUsers: vi.fn(),
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({
  canSeeOrder: () => true,
  managedOrgIds: () => ['org1'],
  getCompanyTeamVisibility: async () => true,
}));
vi.mock('@/lib/auth/policy', () => ({ canReadOrder: async () => true }));
vi.mock('@/lib/auth/documentChannelPolicy', () => ({ canManagerUploadOrderLess: () => true }));
vi.mock('@/lib/services/manager/counterparties', () => ({
  listManagerCounterparties: async () => ({
    organizations: [{ id: 'org1' }],
    partners: [{ id: 'p1' }],
  }),
}));

import {
  createCounterpartyDocument,
  createManagerOrderLessDocument,
} from '@/lib/services/manager/uploads';
import { createOrganizationDocument } from '@/lib/services/organization/documentUpload';
import { createPartnerDocument } from '@/lib/services/partner/documentUpload';
import { uploadAdminDocument } from '@/lib/services/documents/adminUpload';
import type { SessionPayload } from '@/lib/auth/jwt';

const file = () => ({
  name: 'a.pdf',
  size: 4,
  mimeType: 'application/pdf',
  buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
});

const REFUSAL = { ok: false as const, error: 'already_superseded' as const };

const staff = { sub: 'm1', role: 'manager', companyId: 'co1' } as SessionPayload;
const orgUser = { sub: 'o1', role: 'organization' } as SessionPayload;
const partnerUser = { sub: 'p1u', role: 'partner', partnerId: 'p1' } as SessionPayload;
const adminUser = { sub: 'a1', role: 'admin' } as SessionPayload;

const ORDER = {
  id: 'ord1',
  managerId: 'm1',
  organizationId: 'org1',
  partnerId: 'p1',
  companyId: 'co1',
  orderNumber: 'ON-1',
  title: 'Заказ',
};

function prismaWith(extra: Record<string, unknown> = {}) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(ORDER) },
    comment: { count: vi.fn().mockResolvedValue(0) },
    organizationUser: { findFirst: vi.fn().mockResolvedValue({ id: 'ou1' }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ name: 'ООО', companyId: 'co1' }),
      findMany: vi.fn().mockResolvedValue([{ companyId: 'co1' }]),
    },
    partner: { findUnique: vi.fn().mockResolvedValue({ name: 'П' }) },
    ...extra,
  } as never;
}

describe('отказ в замене версии возвращается каналом как есть', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveReplaces.mockResolvedValue(REFUSAL);
  });

  it('сотрудник, документ заказа', async () => {
    const res = await createCounterpartyDocument(prismaWith(), staff, {
      orderId: 'ord1',
      recipient: 'organization',
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('сотрудник, документ без заказа', async () => {
    const res = await createManagerOrderLessDocument(prismaWith(), staff, {
      counterparty: { type: 'organization', id: 'org1' },
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('заказчик, документ заказа', async () => {
    const res = await createOrganizationDocument(prismaWith(), orgUser, {
      organizationId: 'org1',
      orderId: 'ord1',
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('заказчик, документ без заказа', async () => {
    const res = await createOrganizationDocument(prismaWith(), orgUser, {
      organizationId: 'org1',
      orderId: null,
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('партнёр, документ заказа', async () => {
    const res = await createPartnerDocument(prismaWith(), partnerUser, {
      orderId: 'ord1',
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('партнёр, документ без заказа', async () => {
    const res = await createPartnerDocument(prismaWith(), partnerUser, {
      orderId: null,
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });

  it('администратор', async () => {
    const res = await uploadAdminDocument(prismaWith(), adminUser, {
      orderId: 'ord1',
      correlationId: 'c1',
      docType: 'act',
      replacesDocumentId: 'doc-old',
      file: file(),
    });
    expect(res).toEqual(REFUSAL);
    expect(core).not.toHaveBeenCalled();
  });
});
