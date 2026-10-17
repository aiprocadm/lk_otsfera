import type { PrismaClient } from '@prisma/client';

/**
 * Автоматическая подпись ответа на письмо (этап 7 ТЗ 13.10.2026, `У-316`,
 * `Р-7-4`): имя, компания и почта сотрудника из его профиля. Её видно в форме
 * до отправки, а в письме она стоит под текстом после стандартного
 * разделителя «-- », по которому почтовые программы узнают подпись.
 *
 * Внутренний номер телефона в подпись не идёт: он для звонков внутри офиса и
 * клиенту ничего не даст.
 */
export function buildEmailSignature(args: {
  name: string;
  company: string | null;
  email: string;
}): string {
  return ['-- ', 'С уважением,', args.name, args.company, args.email]
    .filter((line): line is string => !!line && line.trim().length > 0)
    .join('\n');
}

export async function emailSignatureFor(prisma: PrismaClient, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, company: { select: { name: true } } },
  });
  if (!user) return '';
  return buildEmailSignature({
    name: user.name,
    company: user.company?.name ?? null,
    email: user.email,
  });
}
