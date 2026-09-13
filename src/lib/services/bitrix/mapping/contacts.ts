import type { ContactChannelType } from '@prisma/client';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import type { BitrixContact } from '../source';
import type { MappingContext, Plan, PlanBefore } from './types';

/**
 * Контакт Битрикса → `Contact` + `ContactChannel` (`У-191`, спека §3.3).
 *
 * Каналы — то, по чему контакт узнаётся: телефон или почта, совпавшие с
 * контактом БЕЗ `bitrixId`, означают «это он» (дописываем `bitrixId`). Канал,
 * занятый контактом с ДРУГИМ `bitrixId`, не отбирается: он остаётся у хозяина,
 * а строка уезжает в конфликты — иначе перенос молча переклеил бы телефон
 * между людьми. Контакт при этом создаётся с остальными каналами.
 *
 * Каналы, совпадающие с почтой сотрудника ЛК, не заводятся вовсе: такие
 * значения принадлежат профилю пользователя (`isUserOwnedChannel`).
 */
export type ContactChannelData = {
  type: ContactChannelType;
  value: string;
  normalizedValue: string;
};

export type ContactData = {
  companyId: string;
  name: string;
  position: string | null;
  organizationId: string | null;
  bitrixId: string;
  channels: ContactChannelData[];
  /** Каналы, которые заняты другим контактом — показываются в предпросмотре. */
  skippedChannels: { value: string; owner: string }[];
};

export type ExistingContact = {
  id: string;
  name: string;
  position: string | null;
  organizationId: string | null;
  bitrixId: string | null;
};

export type ChannelOwnerRef = { contactId: string; contactName: string; bitrixId: string | null };

export type ContactLookup = {
  byBitrixId: (bitrixId: string) => ExistingContact | undefined;
  /** Владелец канала в этой компании: ключ — `<тип>:<нормализованное значение>`. */
  channelOwner: (type: ContactChannelType, normalizedValue: string) => ChannelOwnerRef | undefined;
  contactById: (id: string) => ExistingContact | undefined;
  /** Почта или телефон принадлежат сотруднику ЛК — такой канал контакту не заводим. */
  isUserChannel: (type: ContactChannelType, normalizedValue: string) => boolean;
  /** Организация ЛК по `bitrixId` компании Битрикса. */
  organizationByBitrixId: (bitrixId: string) => string | undefined;
};

export const NO_NAME = 'Без имени';

function channelsOf(contact: BitrixContact): ContactChannelData[] {
  const out: ContactChannelData[] = [];
  const seen = new Set<string>();
  const push = (type: ContactChannelType, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const normalizedValue = normalizeChannelValue(type, value);
    if (!normalizedValue) return;
    const key = `${type}:${normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, value, normalizedValue });
  };
  for (const phone of contact.phones) push('phone', phone);
  for (const email of contact.emails) push('email', email);
  return out;
}

export function planContact(
  contact: BitrixContact,
  ctx: MappingContext,
  lookup: ContactLookup
): Plan<ContactData> {
  const name = [contact.name, contact.lastName]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  const organizationId = contact.companyId
    ? (lookup.organizationByBitrixId(contact.companyId) ?? null)
    : null;

  const wanted = channelsOf(contact);
  const channels: ContactChannelData[] = [];
  const skippedChannels: ContactData['skippedChannels'] = [];
  let matched = lookup.byBitrixId(contact.id);

  for (const channel of wanted) {
    if (lookup.isUserChannel(channel.type, channel.normalizedValue)) continue;
    const owner = lookup.channelOwner(channel.type, channel.normalizedValue);
    if (!owner) {
      channels.push(channel);
      continue;
    }
    if (owner.bitrixId && owner.bitrixId !== contact.id) {
      skippedChannels.push({ value: channel.value, owner: owner.contactName });
      continue;
    }
    // Канал у контакта без `bitrixId` (или у этого же) — значит, это он.
    matched ??= lookup.contactById(owner.contactId);
    channels.push(channel);
  }

  const data: ContactData = {
    companyId: ctx.companyId,
    name: name || NO_NAME,
    position: contact.post?.trim() || null,
    organizationId,
    bitrixId: contact.id,
    channels,
    skippedChannels,
  };

  if (!matched) {
    if (!name && channels.length === 0) {
      // Единственный канал безымянного контакта занят другим человеком: это не
      // «пустая запись», а решение для человека — иначе о потерянном телефоне
      // никто не узнает (`channelConflicts` для пропуска молчит).
      if (skippedChannels.length > 0) {
        return {
          action: 'conflict',
          reason: 'channel_taken',
          hint: skippedChannels.map((c) => `${c.value} — у контакта «${c.owner}»`).join('; '),
        };
      }
      // Контакт без единого канала и без имени переносить незачем: в справочнике
      // он будет строкой «Без имени», которую никто не найдёт.
      return { action: 'skip', reason: 'empty' };
    }
    return { action: 'create', data };
  }

  const patch: Partial<ContactData> = {};
  const before: PlanBefore<ContactData> = {};
  if (name && name !== matched.name) {
    patch.name = name;
    before.name = matched.name;
  }
  if (data.position && data.position !== matched.position) {
    patch.position = data.position;
    before.position = matched.position;
  }
  if (organizationId && organizationId !== matched.organizationId) {
    patch.organizationId = organizationId;
    before.organizationId = matched.organizationId;
  }
  if (!matched.bitrixId) {
    patch.bitrixId = contact.id;
    before.bitrixId = null;
  }
  // Новые каналы дописываются всегда: канал — это способ найти человека,
  // а не поле карточки, и лишним он не бывает.
  const fresh = channels.filter(
    (c) => lookup.channelOwner(c.type, c.normalizedValue)?.contactId !== matched.id
  );
  if (fresh.length > 0) patch.channels = fresh;
  if (skippedChannels.length > 0) patch.skippedChannels = skippedChannels;

  if (Object.keys(patch).length === 0)
    return { action: 'skip', reason: 'no_changes', id: matched.id };
  return { action: 'update', id: matched.id, data: patch, before };
}

/** Строки предпросмотра «канал остался у другого контакта» (`У-191`). */
export function channelConflicts(plan: Plan<ContactData>): string[] {
  const skipped =
    plan.action === 'create'
      ? plan.data.skippedChannels
      : plan.action === 'update'
        ? (plan.data.skippedChannels ?? [])
        : [];
  return skipped.map((s) => `${s.value} — уже у контакта «${s.owner}»`);
}
