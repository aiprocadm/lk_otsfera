import { describe, it, expect, vi } from 'vitest';
import { buildEmailSignature, emailSignatureFor } from '@/lib/services/inbound/emailSignature';

/** Автоматическая подпись ответа на письмо (`У-316`). */
describe('buildEmailSignature', () => {
  it('разделитель «-- », «С уважением», имя, компания, почта', () => {
    expect(
      buildEmailSignature({ name: 'Анна', company: 'ООО «Сфера»', email: 'anna@sfera.ru' })
    ).toBe('-- \nС уважением,\nАнна\nООО «Сфера»\nanna@sfera.ru');
  });
  it('нет компании или пустые строки — строк нет, а не пустые', () => {
    expect(buildEmailSignature({ name: 'Анна', company: null, email: ' ' })).toBe(
      '-- \nС уважением,\nАнна'
    );
  });
});

describe('emailSignatureFor', () => {
  it('собирает из профиля; без компании — без строки компании', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ name: 'Анна', email: 'a@x.ru', company: { name: 'Сфера' } })
      .mockResolvedValueOnce({ name: 'Борис', email: 'b@x.ru', company: null });
    const prisma = { user: { findUnique } } as never;
    expect(await emailSignatureFor(prisma, 'u1')).toBe('-- \nС уважением,\nАнна\nСфера\na@x.ru');
    expect(await emailSignatureFor(prisma, 'u2')).toBe('-- \nС уважением,\nБорис\nb@x.ru');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { name: true, email: true, company: { select: { name: true } } },
    });
  });
  it('сотрудника нет — пустая подпись', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(await emailSignatureFor(prisma, 'нет')).toBe('');
  });
});
