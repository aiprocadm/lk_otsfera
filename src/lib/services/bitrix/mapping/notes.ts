import { NOTE_BODY_MAX } from '@/lib/services/organizationNotes/policy';
import type { BitrixComment } from '../source';
import type { MappingContext, Plan } from './types';

/**
 * Комментарии таймлайна Битрикса → заметки ЛК (`У-191`, спека §3.3).
 *
 * Комментарий сделки становится заметкой сделки, комментарий компании —
 * заметкой организации. Комментарий контакта переносится в заметку ЕГО
 * организации с префиксом «О контакте …»: отдельной ленты у контакта в ЛК нет,
 * а терять переписку жалко. Контакт без организации — единственный случай,
 * когда заметку деть некуда, и она честно считается пропущенной.
 *
 * Автор ищется среди сотрудников; не нашёлся — заметка остаётся без автора и
 * показывается как «Импорт из Битрикс24» (поле `authorId` у `DealNote`
 * специально сделано необязательным в PR-1).
 */
export type DealNoteData = {
  dealId: string;
  body: string;
  authorId: string | null;
  createdAt: Date | null;
};

export type OrganizationNoteData = {
  companyId: string;
  organizationId: string;
  body: string;
  authorId: string | null;
  createdAt: Date | null;
};

export function contactNotePrefix(contactName: string): string {
  return `О контакте ${contactName}: `;
}

/** Тело заметки: пустое не переносим, длинное укорачиваем до предела модели. */
function body(text: string, prefix = ''): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return `${prefix}${trimmed}`.slice(0, NOTE_BODY_MAX);
}

export function planDealNote(
  comment: BitrixComment,
  ctx: MappingContext,
  lookup: { dealByBitrixId: (bitrixId: string) => string | undefined }
): Plan<DealNoteData> {
  const text = body(comment.text);
  if (!text) return { action: 'skip', reason: 'empty' };
  const dealId = lookup.dealByBitrixId(comment.entityId);
  // Сделка могла не перенестись (несопоставленная стадия) — заметке некуда лечь.
  if (!dealId) return { action: 'skip', reason: 'no_contact' };
  return {
    action: 'create',
    data: {
      dealId,
      body: text,
      authorId: ctx.resolveUser(comment.authorId),
      createdAt: comment.createdAt,
    },
  };
}

export function planOrganizationNote(
  comment: BitrixComment,
  ctx: MappingContext,
  lookup: {
    organizationByBitrixId: (bitrixId: string) => string | undefined;
    contactOrganization: (
      bitrixId: string
    ) => { organizationId: string | null; name: string } | undefined;
  }
): Plan<OrganizationNoteData> {
  let organizationId: string | undefined;
  let prefix = '';

  if (comment.entity === 'company') {
    organizationId = lookup.organizationByBitrixId(comment.entityId);
  } else {
    const contact = lookup.contactOrganization(comment.entityId);
    organizationId = contact?.organizationId ?? undefined;
    if (contact) prefix = contactNotePrefix(contact.name);
  }
  if (!organizationId) return { action: 'skip', reason: 'no_organization' };

  const text = body(comment.text, prefix);
  if (!text) return { action: 'skip', reason: 'empty' };

  return {
    action: 'create',
    data: {
      companyId: ctx.companyId,
      organizationId,
      body: text,
      authorId: ctx.resolveUser(comment.authorId),
      createdAt: comment.createdAt,
    },
  };
}
