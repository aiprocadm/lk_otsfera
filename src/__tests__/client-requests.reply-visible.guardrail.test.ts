import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';

const { recordNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  recordNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients: vi.fn(async () => []),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/client-requests/client-request-attachment-dropzone', () => ({
  ClientRequestAttachmentDropzone: () => null,
}));
vi.mock('@/components/client-requests/client-request-attachments-list', () => ({
  ClientRequestAttachmentsList: () => null,
}));

import { notifySubmitterClientRequestStatus } from '@/lib/services/clientRequests/notify';
import { replyToClientRequest } from '@/lib/services/clientRequests/reply';
import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';

/**
 * СТРАЖ `У-238` (решение `Р-Э6-4`): ответ сотрудника на обращение виден клиенту
 * и партнёру дословно — в карточке обращения и в письме; ответ не меняет статус.
 *
 * Мутация (проверено): не класть `reply` в тело уведомления → «письмо содержит
 * текст»; убрать блок «Ответ менеджера» из карточки → «карточка показывает
 * ответ»; писать `status` в `replyToClientRequest` → «статус не трогается».
 */

function row(over: Partial<ClientRequestRow> = {}): ClientRequestRow {
  return {
    id: 'cr1',
    source: 'organization_cabinet',
    companyName: 'ООО Ромашка',
    inn: null,
    contactName: 'Иван',
    contactPhone: null,
    contactEmail: null,
    subject: 'Обучение по охране труда',
    body: null,
    status: 'in_triage',
    submittedByName: 'Иван',
    partnerName: null,
    organizationName: 'ООО Ромашка',
    organizationId: 'org1',
    rejectedReason: null,
    staffReply: null,
    staffRepliedAt: null,
    staffRepliedByName: null,
    createdAt: new Date('2026-09-17T09:00:00Z'),
    triagedAt: null,
    attachmentCount: 0,
    ...over,
  };
}

const REQUEST = {
  id: 'R1',
  source: 'organization_cabinet',
  submittedByUserId: 'u1',
  partnerId: null,
  organizationId: 'org1',
  companyName: 'ООО Ромашка',
  subject: 'Обучение',
  status: 'in_triage',
  rejectedReason: null,
  staffReply: 'Готово: группа набрана, начало 1 октября.',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
});

describe('страж: ответ на обращение виден клиенту (У-238)', () => {
  it('письмо содержит текст ответа; событие «ответ» — свой заголовок и без дедупа', async () => {
    await notifySubmitterClientRequestStatus({} as PrismaClient, REQUEST, { event: 'reply' });
    const rec = recordNotification.mock.calls[0][1];
    expect(rec.title).toBe('Обращение — ответ менеджера');
    expect(rec.body).toContain('Ответ менеджера: Готово: группа набрана, начало 1 октября.');
    expect(rec.entityId).toBeNull();
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Готово: группа набрана') })
    );
  });

  it('смена статуса при наличии ответа тоже несёт его текст', async () => {
    await notifySubmitterClientRequestStatus({} as PrismaClient, REQUEST);
    const rec = recordNotification.mock.calls[0][1];
    expect(rec.title).toBe('Обращение — статус «В работе»');
    expect(rec.body).toContain('Ответ менеджера: Готово');
    expect(rec.entityId).toBe('R1');
  });

  it('карточка обращения у клиента показывает ответ дословно, с именем и датой', () => {
    const html = renderToString(
      React.createElement(ClientRequestDetailView, {
        request: row({
          staffReply: 'Группа набрана, начало 1 октября.',
          staffRepliedAt: new Date('2026-09-17T10:30:00Z'),
          staffRepliedByName: 'Анна Иванова',
        }),
        attachments: [],
        backHref: '/organization/requests',
      })
    );
    expect(html).toContain('Ответ менеджера');
    expect(html).toContain('Группа набрана, начало 1 октября.');
    expect(html).toContain('Анна Иванова');
    const without = renderToString(
      React.createElement(ClientRequestDetailView, {
        request: row(),
        attachments: [],
        backHref: '/organization/requests',
      })
    );
    expect(without).not.toContain('Ответ менеджера');
  });

  it('ответ не трогает статус обращения', async () => {
    const update = vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'R1', ...a.data }));
    const prisma = {
      clientRequest: { findFirst: vi.fn(async () => ({ id: 'R1', staffReply: null })), update },
    } as unknown as PrismaClient;
    const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
    await replyToClientRequest(prisma, session, { id: 'R1', text: 'ответ' });
    expect(Object.keys(update.mock.calls[0][0].data).sort()).toEqual([
      'staffRepliedAt',
      'staffRepliedById',
      'staffReply',
    ]);
  });
});
