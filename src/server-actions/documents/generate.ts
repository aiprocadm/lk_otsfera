'use server';

import { revalidatePath } from 'next/cache';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  generateOrderDocument,
  type GenerateDocType,
  type GenerateResult,
} from '@/lib/services/documents/generate';
import { requestRequisites } from '@/lib/services/documents/requestRequisites';

/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — server-actions генерации документов заказа.
 * Флаг `document_generation` (поведенческий) гейтит оба экшена; сервис
 * энфорсит роль/скоуп.
 */

export async function generateOrderDocumentAction(fd: FormData): Promise<GenerateResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  const orderId = typeof fd.get('orderId') === 'string' ? (fd.get('orderId') as string) : '';
  const docType = fd.get('docType');
  const allowed = ['invoice', 'act', 'contract', 'extra_agreement'];
  if (!orderId || typeof docType !== 'string' || !allowed.includes(docType))
    return { ok: false, error: 'not_found' };

  const res = await generateOrderDocument(prisma, session, {
    orderId,
    docType: docType as GenerateDocType,
  });
  if (res.ok) revalidatePath(`/manager/orders/${orderId}`);
  return res;
}

export type RequestRequisitesResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * «Запросить у клиента» — тонкий адаптер над `requestRequisites`
 * (src/lib/services/documents/requestRequisites.ts): флаг, гард роли и форма
 * входа здесь, скоуп/сбор недостающего/уведомление — в сервисе.
 */
export async function requestRequisitesAction(fd: FormData): Promise<RequestRequisitesResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };
  const orderId = typeof fd.get('orderId') === 'string' ? (fd.get('orderId') as string) : '';
  if (!orderId) return { ok: false, error: 'not_found' };

  return requestRequisites(prisma, session, { orderId });
}
