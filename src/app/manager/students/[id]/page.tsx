import { notFound, redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { studentOrgAccess } from '@/lib/services/students/access';

export const dynamic = 'force-dynamic';

/**
 * Шлюз со старого адреса карточки сотрудника (`У-97`).
 *
 * Сотрудник ведётся внутри организации, поэтому карточка живёт по адресу
 * `/manager/organizations/<организация>/students/<сотрудник>`. Прежний адрес
 * не удаляем — по нему остались закладки и ссылки в письмах, — но он больше
 * не рисует свой экран: у него не было бы даже хлебных крошек (раздел
 * «Сотрудники» из меню снят требованием `У-103`), и человек не понимал бы,
 * где он находится.
 *
 * Скоуп проверяем ДО редиректа: иначе адрес чужой организации утёк бы в
 * строку браузера любому менеджеру, который подставил чужой `id`.
 */
export default async function ManagerStudentGatewayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireManager();

  const student = await prisma.student.findUnique({
    where: { id },
    select: { organizationId: true },
  });
  if (!student) notFound();

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const access = await studentOrgAccess(prisma, session, student.organizationId, teamMode);
  if (!access.canRead) notFound();

  redirect(`/manager/organizations/${student.organizationId}/students/${id}`);
}
