import type { ContactChannelType, PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { writeSyncLog } from './log';

/**
 * Контакты контрагента из 1С (`У-256`, этап 8).
 *
 * В 1С у контрагента записаны живые люди — кому звонить и кому писать. В
 * кабинете эти же люди заводятся руками заново, и дальше два списка живут
 * каждый своей жизнью: менеджер звонит по телефону из 1С, а система пишет
 * письмо на адрес из кабинета.
 *
 * Три правила, ради которых всё написано так, а не проще:
 *
 * 1. **Пустое из 1С не затирает заполненное** (`Р-Э8-7`) — то же правило, что
 *    у реквизитов организации (`У-171`). Контрагент без должности в 1С не
 *    должен стирать должность, которую менеджер вписал руками.
 * 2. **Канал, занятый контактом ДРУГОЙ организации, не пишется вовсе.** Тот же
 *    телефон у двух контрагентов — это либо один человек на две компании, либо
 *    ошибка в 1С; и то и другое решает человек через объединение контактов, а
 *    не импорт молча. В журнал обмена уходит строка `warn` со ссылкой.
 * 3. **Повторный запуск не создаёт дублей** — это и есть критерий приёмки.
 *    Держится тем, что поиск идёт по НОРМАЛИЗОВАННОМУ каналу: «+7 (900)
 *    123-45-67» и «89001234567» — один и тот же телефон.
 */

export type OneCContactDto = {
  name: string;
  position?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
};

export type OneCContactsResult = {
  created: number;
  updated: number;
  /** Канал занят контактом другой организации — не пишем, зовём человека. */
  conflicts: number;
};

type ChannelInput = { type: ContactChannelType; value: string; normalizedValue: string };

/** Каналы контакта из 1С в том виде, в каком их ищут и пишут. */
function channelsOf(dto: OneCContactDto): ChannelInput[] {
  const out: ChannelInput[] = [];
  for (const [type, raw] of [
    ['phone', dto.phone],
    ['email', dto.email],
  ] as const) {
    const value = raw?.trim();
    if (!value) continue;
    const normalizedValue = normalizeChannelValue(type, value);
    // Мусор вместо телефона («звонить через секретаря») нормализатор не
    // разбирает — такой канал просто не заводим, а контакт создаём: имя и
    // должность полезны и без него.
    if (normalizedValue) out.push({ type, value, normalizedValue });
  }
  return out;
}

/**
 * Перенести контакты контрагента из 1С в карточку организации.
 *
 * Возвращает счётчики, а не бросает: сбой на одном контакте не должен ронять
 * импорт всего контрагента — организация уже записана, и откатывать её из-за
 * телефона неправильно.
 */
export async function syncOrgContactsFromOneC(
  db: PrismaClient,
  args: {
    organizationId: string;
    companyId: string;
    externalId: string;
    contacts: OneCContactDto[];
  }
): Promise<OneCContactsResult> {
  const result: OneCContactsResult = { created: 0, updated: 0, conflicts: 0 };

  for (const dto of args.contacts) {
    const name = dto.name.trim();
    if (!name) continue;
    const channels = channelsOf(dto);

    // Ищем по каналам в пределах компании: `(companyId, type, normalizedValue)`
    // уникален, поэтому владелец канала ровно один.
    const owners = channels.length
      ? await db.contactChannel.findMany({
          where: {
            companyId: args.companyId,
            OR: channels.map((c) => ({ type: c.type, normalizedValue: c.normalizedValue })),
          },
          select: { contactId: true, contact: { select: { organizationId: true } } },
        })
      : [];

    const foreign = owners.find((o) => o.contact.organizationId !== args.organizationId);
    if (foreign) {
      // Правило 2: не пишем и зовём человека. Импорт при этом не падает.
      result.conflicts += 1;
      await writeSyncLog(
        {
          entity: 'contact',
          externalId: args.externalId,
          direction: 'inbound',
          operation: 'skip',
          status: 'warn',
          errorMessage: `Канал контакта «${name}» занят контактом другой организации — объедините контакты вручную`,
          payload: {
            organizationId: args.organizationId,
            contactName: name,
            conflictingContactId: foreign.contactId,
            mergeHref: `/manager/contacts/${foreign.contactId}`,
          },
        },
        db
      );
      continue;
    }

    const existingId = owners[0]?.contactId ?? null;

    if (existingId) {
      // Правило 1: непустое из 1С обновляет, пустое — не трогает.
      const patch: { name?: string; position?: string } = { name };
      if (dto.position?.trim()) patch.position = dto.position.trim();
      await db.contact.update({ where: { id: existingId }, data: patch });

      // Каналы, которых у контакта ещё нет, дописываем через `upsert`: он же
      // делает повторный запуск безвредным — существующий канал не трогается.
      for (const channel of channels) {
        try {
          await db.contactChannel.upsert({
            where: {
              companyId_type_normalizedValue: {
                companyId: args.companyId,
                type: channel.type,
                normalizedValue: channel.normalizedValue,
              },
            },
            update: {},
            create: {
              contactId: existingId,
              companyId: args.companyId,
              type: channel.type,
              value: channel.value,
              normalizedValue: channel.normalizedValue,
            },
          });
        } catch (err) {
          log.warn('[oneCSync/contacts] канал не записан', {
            organizationId: args.organizationId,
            type: channel.type,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      result.updated += 1;
      continue;
    }

    await db.contact.create({
      data: {
        companyId: args.companyId,
        organizationId: args.organizationId,
        name,
        ...(dto.position?.trim() ? { position: dto.position.trim() } : {}),
        channels: {
          create: channels.map((c) => ({
            companyId: args.companyId,
            type: c.type,
            value: c.value,
            normalizedValue: c.normalizedValue,
          })),
        },
      },
      select: { id: true },
    });
    result.created += 1;
  }

  return result;
}
