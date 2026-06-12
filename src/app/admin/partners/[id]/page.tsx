import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BackLink, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getPartner } from '@/lib/services/admin/partners';
import { PartnerEditForm } from '@/components/admin/partner-edit-form';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const partner = await getPartner(prisma, id);
  if (!partner) notFound();

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <BackLink href='/admin/partners' label='Все партнёры' />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Партнёр: {partner.name}</h1>
        <p className="text-sm text-gray-500">slug: {partner.slug}</p>
      </div>

      <PartnerEditForm partner={partner} />

      <div>
        <h2 className="text-lg font-semibold text-[#111111] mb-3">
          Администраторы партнёра ({partner.admins.length})
        </h2>
        {partner.admins.length === 0 ? (
          <p className="text-sm text-gray-500">Нет администраторов.</p>
        ) : (
          <TableShell>
            <THead className="bg-[#F3F4F6]">
              <Th className="py-2 text-[#111111]">Email</Th>
              <Th className="py-2 text-[#111111]">Имя</Th>
              <Th className="py-2 text-[#111111]">Активен</Th>
              <Th className="py-2 text-[#111111]">Создан</Th>
              <Th className="py-2 text-[#111111]">Действия</Th>
            </THead>
            <tbody>
              {partner.admins.map((admin) => (
                <Tr key={admin.partnerUserId} hover={false} className="border-gray-100">
                  <Td className="py-2 text-gray-700">{admin.email}</Td>
                  <Td className="py-2 text-gray-700">{admin.name}</Td>
                  <Td className="py-2">
                    {admin.isActive ? (
                      <span className="text-green-600">Да</span>
                    ) : (
                      <span className="text-red-500">Нет</span>
                    )}
                  </Td>
                  <Td className="py-2 text-gray-500">
                    {fmtDate(admin.createdAt)}
                  </Td>
                  <Td className="py-2">
                    <Link
                      href={`/admin/users/${admin.userId}`}
                      className="text-[#F97316] hover:text-[#EA580C] text-xs"
                    >
                      Открыть
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}
