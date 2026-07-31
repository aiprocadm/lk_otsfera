import type { ClientRequest, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSubmitClientRequest } from './policy';
import { notifyManagersClientRequestSubmitted } from './notify';

export type SubmitClientRequestInput = {
  companyName?: string | null;
  inn?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  subject?: string | null;
  body?: string | null;
  /** Для роли organization: явный выбор организации из членств (иначе активная). */
  organizationId?: string | null;
};

export type SubmitClientRequestResult =
  | { ok: true; request: ClientRequest }
  | { ok: false; error: 'forbidden' | 'validation'; messages?: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Валидация полей заявки (решение §9-2 спеки): компания*, контактное лицо*,
 * тема*, телефон или email — хотя бы одно; ИНН — если задан, 10 или 12 цифр
 * (только формат; на дубли на клиентской стороне НЕ проверяется — ФТ-13.4).
 * Чистая функция, русские сообщения. Экспортируется для переиспользования формой.
 */
export function validateClientRequestInput(
  input: SubmitClientRequestInput
):
  | {
      ok: true;
      values: {
        companyName: string;
        inn: string | null;
        contactName: string;
        contactPhone: string | null;
        contactEmail: string | null;
        subject: string;
        body: string | null;
      };
    }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const companyName = input.companyName?.trim() ?? '';
  const contactName = input.contactName?.trim() ?? '';
  const contactPhone = input.contactPhone?.trim() || null;
  const contactEmail = input.contactEmail?.trim().toLowerCase() || null;
  const subject = input.subject?.trim() ?? '';
  const innDigits = input.inn?.replace(/[\s-]/g, '') || null;

  if (!companyName) errors.push('Укажите название компании');
  if (!contactName) errors.push('Укажите контактное лицо');
  if (!subject) errors.push('Укажите тему обращения');
  if (!contactPhone && !contactEmail) errors.push('Укажите телефон или email для связи');
  if (contactEmail && !EMAIL_RE.test(contactEmail))
    errors.push(`Некорректный email «${contactEmail}»`);
  if (innDigits && !/^(\d{10}|\d{12})$/.test(innDigits))
    errors.push('ИНН должен содержать 10 или 12 цифр');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    values: {
      companyName,
      inn: innDigits,
      contactName,
      contactPhone,
      contactEmail,
      subject,
      body: input.body?.trim() || null,
    },
  };
}

/**
 * Подача заявки клиента (этап 5, ФТ-1.2/1.3). Роли — только клиентские
 * (партнёр/организация); источник и принадлежность выводятся из сессии,
 * не из входа. Аудит без ПДн; уведомление менеджерам best-effort.
 */
export async function submitClientRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  input: SubmitClientRequestInput
): Promise<SubmitClientRequestResult> {
  if (!canSubmitClientRequest(session)) return { ok: false, error: 'forbidden' };

  const validated = validateClientRequestInput(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };

  let partnerId: string | null = null;
  let organizationId: string | null = null;
  if (session.role === 'partner') {
    partnerId = session.partnerId ?? null;
    if (!partnerId) return { ok: false, error: 'forbidden' };
  } else {
    const activeIds = (session.organizationMemberships ?? [])
      .filter((m) => m.isActive)
      .map((m) => m.organizationId);
    const requested = input.organizationId?.trim() || null;
    if (requested) {
      if (!activeIds.includes(requested)) return { ok: false, error: 'forbidden' };
      organizationId = requested;
    } else {
      // Дефолт тоже только из АКТИВНЫХ членств: session.organizationId в JWT
      // может пережить деактивацию членства.
      organizationId =
        session.organizationId && activeIds.includes(session.organizationId)
          ? session.organizationId
          : (activeIds[0] ?? null);
    }
    if (!organizationId) return { ok: false, error: 'forbidden' };
  }

  const request = await prisma.clientRequest.create({
    data: {
      source: session.role === 'partner' ? 'partner_cabinet' : 'organization_cabinet',
      submittedByUserId: session.sub,
      partnerId,
      organizationId,
      ...validated.values,
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'client_request_submitted',
    entity: 'client_request',
    entityId: request.id,
    // Только принадлежность — ПДн контакта в аудит не пишем.
    after: { source: request.source, partnerId, organizationId },
  });

  await notifyManagersClientRequestSubmitted(prisma, request);

  return { ok: true, request };
}
