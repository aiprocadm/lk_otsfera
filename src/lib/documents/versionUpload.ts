import type { DocumentDetail } from '@/lib/services/documents/detail';

/**
 * Куда кабинет отправляет новую версию документа (`У-251`).
 *
 * Дверей загрузки пять, и у каждой свой набор полей: у сотрудника — заказ либо
 * контрагент, у заказчика — организация, у партнёра — только заказ. Собирать
 * этот набор прямо в странице значит написать его пять раз и на первой правке
 * рассогласовать. Здесь чистые функции: страница зовёт свою и отдаёт результат
 * форме.
 *
 * `null` — кнопки нет: либо сервер не разрешил замену (`canUploadVersion`),
 * либо у документа нет контрагента (КП лиду, `У-161`) и отправлять некуда.
 */
export type VersionUploadTarget = {
  url: string;
  /** Поля формы помимо файла и `replacesDocumentId`. */
  fields: Record<string, string>;
};

type DocLike = Pick<DocumentDetail, 'type' | 'canUploadVersion' | 'order' | 'counterparty'>;

/** Кабинеты менеджера и руководителя: заказ — своя дверь, без заказа — своя. */
export function staffVersionUploadTarget(doc: DocLike): VersionUploadTarget | null {
  if (!doc.canUploadVersion) return null;
  const type = doc.counterparty.type;
  if (type !== 'organization' && type !== 'partner') return null;

  if (doc.order) {
    return {
      url: `/api/manager/documents/${doc.order.id}/upload`,
      fields: { docType: doc.type, recipient: type },
    };
  }
  if (!doc.counterparty.id) return null;
  return {
    url: '/api/manager/documents/order-less',
    fields: { counterpartyType: type, counterpartyId: doc.counterparty.id, docType: doc.type },
  };
}

/**
 * Администратор: свой давний канал загрузки, привязанный к заказу. Документа
 * без заказа он этой дверью не заменит — у неё нет ветки «без заказа», и
 * дорисовывать её ради одной кнопки значило бы менять чужой канал.
 */
export function adminVersionUploadTarget(doc: DocLike): VersionUploadTarget | null {
  if (!doc.canUploadVersion || !doc.order) return null;
  if (doc.counterparty.type !== 'organization') return null;
  return {
    url: '/api/documents/upload',
    fields: { orderId: doc.order.id, docType: doc.type },
  };
}

/**
 * Кабинет заказчика. Организацию берём у САМОГО документа, а не из активной
 * вкладки шапки: у человека их может быть несколько, и подставить туда
 * текущую значило бы отправить файл не в ту папку. Членство в ней сервис
 * всё равно проверит заново.
 */
export function organizationVersionUploadTarget(doc: DocLike): VersionUploadTarget | null {
  if (!doc.canUploadVersion) return null;
  if (doc.counterparty.type !== 'organization' || !doc.counterparty.id) return null;
  return {
    url: '/api/organization/documents/upload',
    fields: {
      organizationId: doc.counterparty.id,
      orderId: doc.order?.id ?? '',
      docType: doc.type,
    },
  };
}

/** Кабинет партнёра: партнёр берётся из сессии, в форму его не кладём. */
export function partnerVersionUploadTarget(doc: DocLike): VersionUploadTarget | null {
  if (!doc.canUploadVersion) return null;
  if (doc.counterparty.type !== 'partner') return null;
  return {
    url: '/api/partner/documents/upload',
    fields: { orderId: doc.order?.id ?? '', docType: doc.type },
  };
}
