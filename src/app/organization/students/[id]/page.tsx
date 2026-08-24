import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Шлюз со старого адреса карточки сотрудника (`У-97`, `У-100`).
 *
 * Карточка переехала внутрь раздела «Моя организация». Проверять чужой ли это
 * сотрудник здесь не нужно и нечем: организация у заказчика своя, а сама
 * карточка на новом адресе всё равно спрашивает членство и отвечает «не
 * найдено» для чужого человека.
 */
export default async function OrganizationStudentGatewayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOrganization();
  redirect(`/organization/company/students/${id}`);
}
