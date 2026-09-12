import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { findChannelOwner, isUserOwnedChannel } from '@/lib/services/contacts/channels';

/**
 * Каналы контакта (этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3–§3.4):
 * `findChannelOwner` ищет владельца канала по нормализованному значению в
 * пределах компании (и умеет исключать сам контакт) — из этого строится
 * подсказка «занято контактом …» вместо `P2002`; `isUserOwnedChannel`
 * отличает канал пользователя кабинета — такой правится в профиле, а не в
 * контакте (`contact_channel_locked`).
 */
const findFirst = vi.fn();
const prisma = { contactChannel: { findFirst } } as unknown as PrismaClient;
const SELECT = { contactId: true, contact: { select: { name: true } } };

describe('findChannelOwner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пустое после нормализации значение — null без запроса к базе', async () => {
    await expect(
      findChannelOwner(prisma, { companyId: 'c1', type: 'phone', value: 'abc' })
    ).resolves.toBeNull();
    await expect(
      findChannelOwner(prisma, { companyId: 'c1', type: 'email', value: '   ' })
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('владелец найден — id и имя; телефон ищется по канону «+7…», e-mail — в нижнем регистре', async () => {
    findFirst.mockResolvedValueOnce({ contactId: 'k2', contact: { name: 'Петров П.П.' } });
    await expect(
      findChannelOwner(prisma, { companyId: 'c1', type: 'phone', value: '8 (921) 123-45-67' })
    ).resolves.toEqual({ contactId: 'k2', name: 'Петров П.П.' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { companyId: 'c1', type: 'phone', normalizedValue: '+79211234567' },
      select: SELECT,
    });

    findFirst.mockResolvedValueOnce({ contactId: 'k3', contact: { name: 'Иванов' } });
    await expect(
      findChannelOwner(prisma, { companyId: 'c1', type: 'email', value: ' Ivan@Test.RU ' })
    ).resolves.toEqual({ contactId: 'k3', name: 'Иванов' });
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { companyId: 'c1', type: 'email', normalizedValue: 'ivan@test.ru' },
      select: SELECT,
    });
  });

  it('никто не владеет — null; excludeContactId исключает сам контакт из поиска', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(
      findChannelOwner(prisma, {
        companyId: 'c1',
        type: 'telegram',
        value: ' 100500 ',
        excludeContactId: 'k1',
      })
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'c1',
        type: 'telegram',
        normalizedValue: '100500',
        contactId: { not: 'k1' },
      },
      select: SELECT,
    });
  });
});

describe('isUserOwnedChannel', () => {
  const user = {
    email: ' Ivan@Test.ru ',
    telegramChatId: ' tg-1 ',
    maxChatId: ' max-1 ',
    whatsappPhone: '8 (921) 123-45-67',
  };

  it('без пользователя кабинета канал никому не принадлежит', () => {
    expect(isUserOwnedChannel(null, { type: 'email', normalizedValue: 'ivan@test.ru' })).toBe(
      false
    );
  });

  it.each([
    ['e-mail совпал (без регистра и пробелов)', 'email', 'ivan@test.ru', true],
    ['e-mail другой', 'email', 'petr@test.ru', false],
    ['telegram совпал', 'telegram', 'tg-1', true],
    ['telegram другой', 'telegram', 'tg-2', false],
    ['max совпал', 'max', 'max-1', true],
    ['max другой', 'max', 'max-2', false],
    ['телефон совпал с каноном номера WhatsApp', 'phone', '+79211234567', true],
    ['телефон другой', 'phone', '+79210000000', false],
    ['whatsapp совпал с каноном', 'whatsapp', '+79211234567', true],
    ['whatsapp другой', 'whatsapp', '+79210000000', false],
  ] as const)('%s', (_name, type, normalizedValue, expected) => {
    expect(isUserOwnedChannel(user, { type, normalizedValue })).toBe(expected);
  });

  it('пустые поля пользователя — канал не его, даже если значение «совпало бы» с пустотой', () => {
    const empty = {
      email: 'x@test.ru',
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
    };
    expect(isUserOwnedChannel(empty, { type: 'telegram', normalizedValue: '' })).toBe(false);
    expect(isUserOwnedChannel(empty, { type: 'max', normalizedValue: '' })).toBe(false);
    expect(isUserOwnedChannel(empty, { type: 'phone', normalizedValue: '' })).toBe(false);
    expect(isUserOwnedChannel(empty, { type: 'whatsapp', normalizedValue: '' })).toBe(false);
    expect(isUserOwnedChannel(empty, { type: 'email', normalizedValue: 'x@test.ru' })).toBe(true);
  });
});
