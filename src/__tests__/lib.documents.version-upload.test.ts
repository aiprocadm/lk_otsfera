/**
 * `У-251` — куда кабинет отправляет новую версию документа.
 *
 * Чистые функции: пять дверей загрузки с разными наборами полей. Ошибка здесь
 * не падает, а тихо кладёт файл не туда, поэтому каждый набор проверяется
 * целиком, а не «вызвалось без исключения».
 */
import { describe, it, expect } from 'vitest';
import {
  staffVersionUploadTarget,
  adminVersionUploadTarget,
  organizationVersionUploadTarget,
  partnerVersionUploadTarget,
} from '@/lib/documents/versionUpload';
import type { DocumentDetail } from '@/lib/services/documents/detail';

type Doc = Pick<DocumentDetail, 'type' | 'canUploadVersion' | 'order' | 'counterparty'>;

const ORDER = { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' };

function doc(over: Partial<Doc> = {}): Doc {
  return {
    type: 'invoice',
    canUploadVersion: true,
    order: ORDER,
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    ...over,
  };
}

describe('куда отправляется новая версия', () => {
  it('сервер запретил замену — кнопки нет ни в одном кабинете', () => {
    const forbidden = doc({ canUploadVersion: false });
    expect(staffVersionUploadTarget(forbidden)).toBeNull();
    expect(adminVersionUploadTarget(forbidden)).toBeNull();
    expect(organizationVersionUploadTarget(forbidden)).toBeNull();
    expect(partnerVersionUploadTarget(forbidden)).toBeNull();
  });

  it('сотрудник: документ заказа уходит в дверь заказа', () => {
    expect(staffVersionUploadTarget(doc())).toEqual({
      url: '/api/manager/documents/ord1/upload',
      fields: { docType: 'invoice', recipient: 'organization' },
    });
  });

  it('сотрудник: документ партнёра уходит с получателем «партнёр»', () => {
    const d = doc({ counterparty: { type: 'partner', id: 'p1', name: 'Партнёр А' } });
    expect(staffVersionUploadTarget(d)?.fields.recipient).toBe('partner');
  });

  it('сотрудник: документ без заказа уходит в свою дверь', () => {
    const d = doc({ order: null });
    expect(staffVersionUploadTarget(d)).toEqual({
      url: '/api/manager/documents/order-less',
      fields: { counterpartyType: 'organization', counterpartyId: 'org1', docType: 'invoice' },
    });
  });

  it('сотрудник: у документа без контрагента отправлять некуда', () => {
    // `У-161`: коммерческое предложение лиду — контрагента у него нет.
    const d = doc({ counterparty: { type: null, id: null, name: null } });
    expect(staffVersionUploadTarget(d)).toBeNull();
  });

  it('сотрудник: документ без заказа и без идентификатора контрагента не отправляется', () => {
    const d = doc({ order: null, counterparty: { type: 'organization', id: null, name: null } });
    expect(staffVersionUploadTarget(d)).toBeNull();
  });

  it('администратор: своя дверь и только по заказу', () => {
    expect(adminVersionUploadTarget(doc())).toEqual({
      url: '/api/documents/upload',
      fields: { orderId: 'ord1', docType: 'invoice' },
    });
    expect(adminVersionUploadTarget(doc({ order: null }))).toBeNull();
    const partnerDoc = doc({ counterparty: { type: 'partner', id: 'p1', name: 'П' } });
    expect(adminVersionUploadTarget(partnerDoc)).toBeNull();
  });

  it('заказчик: организация берётся у документа, а не у активной вкладки', () => {
    expect(organizationVersionUploadTarget(doc())).toEqual({
      url: '/api/organization/documents/upload',
      fields: { organizationId: 'org1', orderId: 'ord1', docType: 'invoice' },
    });
  });

  it('заказчик: документ без заказа отправляется с пустым заказом', () => {
    expect(organizationVersionUploadTarget(doc({ order: null }))?.fields.orderId).toBe('');
  });

  it('заказчик: чужой канал не отправляется', () => {
    const d = doc({ counterparty: { type: 'partner', id: 'p1', name: 'П' } });
    expect(organizationVersionUploadTarget(d)).toBeNull();
    const noId = doc({ counterparty: { type: 'organization', id: null, name: null } });
    expect(organizationVersionUploadTarget(noId)).toBeNull();
  });

  it('партнёр: партнёра в форму не кладём — его знает сессия', () => {
    const d = doc({ counterparty: { type: 'partner', id: 'p1', name: 'Партнёр А' } });
    expect(partnerVersionUploadTarget(d)).toEqual({
      url: '/api/partner/documents/upload',
      fields: { orderId: 'ord1', docType: 'invoice' },
    });
    expect(partnerVersionUploadTarget(doc())).toBeNull();
  });

  it('партнёр: документ без заказа отправляется с пустым заказом', () => {
    const d = doc({ order: null, counterparty: { type: 'partner', id: 'p1', name: 'П' } });
    expect(partnerVersionUploadTarget(d)?.fields.orderId).toBe('');
  });
});
