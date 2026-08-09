import type { PrismaClient } from '@prisma/client';

/**
 * Поиск дублей сотрудника (`У-22`, этап 5 ТЗ понятности).
 *
 * Порядок ключей задан ТЗ и не переставляется:
 *   1. СНИЛС — если указан, это самый надёжный признак;
 *   2. иначе ФИО + дата рождения;
 *   3. иначе ФИО + email.
 *
 * **Дубль не запрещается**: функция только сообщает о совпадении, а решение
 * принимает человек («Использовать существующего» / «Всё равно добавить»).
 * Однофамильцы существуют, и блокировка ввода дороже дубля — решение
 * заказчика 09.08.2026.
 */
export type DuplicateCandidate = {
  id: string;
  name: string;
  snils: string | null;
  birthDate: Date | null;
  email: string | null;
  position: string | null;
  status: string;
};

export type DuplicateMatch = 'snils' | 'name_birthdate' | 'name_email';

const SELECT = {
  id: true,
  name: true,
  snils: true,
  birthDate: true,
  email: true,
  position: true,
  status: true,
} as const;

/** СНИЛС сравнивается по цифрам: «112-233-445 95» и «11223344595» — одно и то же. */
export function normalizeSnils(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export async function findDuplicates(
  prisma: PrismaClient,
  args: {
    organizationId: string;
    name: string;
    snils?: string | null;
    birthDate?: Date | null;
    email?: string | null;
    /** Исключить сотрудника из поиска — при редактировании он не дубль сам себе. */
    excludeId?: string;
  }
): Promise<{ match: DuplicateMatch; candidates: DuplicateCandidate[] } | null> {
  const base = {
    organizationId: args.organizationId,
    ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
  };
  const name = args.name.trim();

  const snils = normalizeSnils(args.snils);
  if (snils) {
    // Хранить можем и с разделителями, поэтому сравниваем нормализованно на
    // стороне приложения: организаций-сотрудников десятки, не миллионы.
    const sameOrg = await prisma.student.findMany({ where: base, select: SELECT });
    const candidates = sameOrg.filter((s) => normalizeSnils(s.snils) === snils);
    if (candidates.length > 0) return { match: 'snils', candidates };
  }

  if (args.birthDate) {
    const candidates = await prisma.student.findMany({
      where: { ...base, name, birthDate: args.birthDate },
      select: SELECT,
    });
    if (candidates.length > 0) return { match: 'name_birthdate', candidates };
  }

  if (args.email) {
    const candidates = await prisma.student.findMany({
      where: { ...base, name, email: args.email },
      select: SELECT,
    });
    if (candidates.length > 0) return { match: 'name_email', candidates };
  }

  return null;
}
