'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  generateOrderDocument,
  type GenerateDocType,
  type GenerateResult,
} from '@/lib/services/documents/generate';
import { notifyOrgUsers } from '@/lib/notifications';
import { listMissingRequisites } from '@/lib/documents/requisites-check';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { log } from '@/lib/logging';

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

/** «Запросить у клиента» — уведомление организации со списком недостающего. */
export async function requestRequisitesAction(fd: FormData): Promise<RequestRequisitesResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  if (session.role !== 'manager' && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };
  const orderId = typeof fd.get('orderId') === 'string' ? (fd.get('orderId') as string) : '';
  if (!orderId) return { ok: false, error: 'not_found' };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      title: true,
      orderNumber: true,
      companyId: true,
      organizationId: true,
      managerId: true,
    },
  });
  if (!order || !order.organizationId || !order.companyId) return { ok: false, error: 'not_found' };

  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const visible = canSeeOrder(
      session,
      {
        managerId: order.managerId,
        organizationId: order.organizationId,
        companyId: order.companyId,
      },
      teamMode
    );
    if (!visible) return { ok: false, error: 'not_found' };
  }

  const REQ = {
    name: true,
    legalName: true,
    inn: true,
    kpp: true,
    legalAddress: true,
    bankName: true,
    bankAccount: true,
    corrAccount: true,
    bic: true,
    signerName: true,
    signerPosition: true,
  } as const;
  const [company, organization] = await Promise.all([
    prisma.company.findUnique({ where: { id: order.companyId }, select: REQ }),
    prisma.organization.findUnique({ where: { id: order.organizationId }, select: REQ }),
  ]);
  if (!company || !organization) return { ok: false, error: 'not_found' };

  const missing = listMissingRequisites(company, organization).filter(
    (m) => m.side === 'organization'
  );
  try {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'requisites_requested',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        missingLabels: missing.map((m) => m.label),
      },
    });
  } catch (err) {
    // best-effort: сбой доставки не считаем ошибкой действия
    log.warn('[documents/requestRequisites] notify failed', {
      orderId,
      error: (err as Error).message,
    });
  }
  return { ok: true };
}
