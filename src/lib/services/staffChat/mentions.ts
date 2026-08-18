import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaff, NO_COMPANY_SENTINEL } from './policy';

export type StaffColleague = { id: string; name: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Точный матч «@Имя» по списку staff: длинные имена первыми (жадность), регистронезависимо,
 * дедуп. Никакой нечёткости — ненайденное игнорируется (решение спеки §2.5).
 */
export function extractMentions(body: string, staff: StaffColleague[]): string[] {
  const found: string[] = [];
  const sorted = [...staff]
    .filter((s) => s.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  let rest = body;
  for (const person of sorted) {
    const re = new RegExp(`@${escapeRegExp(person.name)}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(rest)) {
      found.push(person.id);
      rest = rest.replace(
        new RegExp(`@${escapeRegExp(person.name)}(?![\\p{L}\\p{N}])`, 'giu'),
        ' '
      );
    }
  }
  return found;
}

export type ListColleaguesResult = { ok: true; rows: StaffColleague[] };

/** Staff-состав для автокомплита/пикера: менеджеры компании + активные admin (Model A — участвуют везде). */
export async function listColleagues(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ListColleaguesResult> {
  if (!isStaff(session)) return { ok: true, rows: [] };
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        {
          role: { in: ['manager', 'leader'] },
          // admin (Model A) видит менеджеров всех компаний: ключ companyId в
          // where отсутствует ⇒ Prisma не фильтрует по нему.
          ...(session.role === 'admin'
            ? {}
            : { companyId: session.companyId ?? NO_COMPANY_SENTINEL }),
        },
        { role: 'admin' },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return { ok: true, rows };
}
