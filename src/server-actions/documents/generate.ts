'use server';

import { revalidatePath } from 'next/cache';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { generateOrderDocument, type GenerateResult } from '@/lib/services/documents/generate';
import { issueInputSchema, toGenerateArgs } from '@/lib/documents/issueInput';
import { requestRequisites } from '@/lib/services/documents/requestRequisites';
import { resolveOrgIssueScope } from '@/lib/services/documents/issueScope';
import {
  getOrgDocumentIssuePanel,
  type OrgDocumentIssuePanel,
} from '@/lib/services/documents/generationPanel';

/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — server-actions генерации документов заказа.
 * Флаг `document_generation` (поведенческий) гейтит оба экшена; сервис
 * энфорсит роль/скоуп.
 */

export async function generateOrderDocumentAction(fd: FormData): Promise<GenerateResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  // Форма выпуска (`У-147`) присылает поля одним JSON: та же схема, что у
  // предпросмотра, — иначе предпросмотр и выпуск разъехались бы.
  const raw = fd.get('payload');
  if (typeof raw !== 'string') return { ok: false, error: 'not_found' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not_found' };
  }
  const input = issueInputSchema.safeParse(parsed);
  if (!input.success) return { ok: false, error: 'not_found' };

  const res = await generateOrderDocument(prisma, session, toGenerateArgs(input.data));
  if (res.ok) {
    // `У-145`: у документа без заказа обновлять нужно карточку организации —
    // адрес заказа для него не существует.
    revalidatePath(
      input.data.orderId
        ? `/manager/orders/${input.data.orderId}`
        : `/manager/organizations/${input.data.organizationId}`
    );
  }
  return res;
}

export type RequestRequisitesResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' }
  /** `У-157`: повтор раньше суток — говорим, когда просили в прошлый раз. */
  | { ok: false; error: 'requested_recently'; requestedAt: Date };

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

export type OrgIssuePanelResult =
  | { ok: true; panel: OrgDocumentIssuePanel }
  | { ok: false; error: 'forbidden' | 'not_found' | 'org_no_company' };

/**
 * Данные формы выпуска документа **без заказа** (`У-145`) — по клику, а не
 * заранее.
 *
 * Почему действием, а не пропсами страницы: точек входа две (карточка
 * организации и доска сделок), и на доске организаций столько же, сколько
 * карточек. Грузить каталог и реквизиты каждой из них при отрисовке доски
 * означало бы платить за то, чего человек не открывал.
 *
 * Гейт здесь свой и тот же, что у выпуска (`resolveOrgIssueScope`): скрытая
 * кнопка — это внешний вид, а не запрет (§4).
 */
export async function orgIssuePanelAction(fd: FormData): Promise<OrgIssuePanelResult> {
  if (!isFeatureEnabled('document_generation')) return { ok: false, error: 'forbidden' };
  const session = await requireSession();
  const organizationId =
    typeof fd.get('organizationId') === 'string' ? (fd.get('organizationId') as string) : '';
  if (!organizationId) return { ok: false, error: 'not_found' };

  const scope = await resolveOrgIssueScope(prisma, session, organizationId);
  if (!scope.ok) return scope;

  const panel = await getOrgDocumentIssuePanel(prisma, {
    organizationId,
    companyId: scope.companyId,
  });
  return { ok: true, panel };
}
