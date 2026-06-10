import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getPartner } from '@/lib/services/admin/partners';
import { PartnerEditForm } from '@/components/admin/partner-edit-form';

export const dynamic = 'force-dynamic';

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const partner = await getPartner(prisma, id);
  if (!partner) notFound();

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/admin/partners" className="text-xs text-gray-500 hover:text-[#F97316]">
          ← К списку
        </Link>
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
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F3F4F6] text-left">
                  <th scope='col' className="px-4 py-2 font-medium text-[#111111]">Email</th>
                  <th scope='col' className="px-4 py-2 font-medium text-[#111111]">Имя</th>
                  <th scope='col' className="px-4 py-2 font-medium text-[#111111]">Активен</th>
                  <th scope='col' className="px-4 py-2 font-medium text-[#111111]">Создан</th>
                  <th scope='col' className="px-4 py-2 font-medium text-[#111111]">Действия</th>
                </tr>
              </thead>
              <tbody>
                {partner.admins.map((admin) => (
                  <tr key={admin.partnerUserId} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-700">{admin.email}</td>
                    <td className="px-4 py-2 text-gray-700">{admin.name}</td>
                    <td className="px-4 py-2">
                      {admin.isActive ? (
                        <span className="text-green-600">Да</span>
                      ) : (
                        <span className="text-red-500">Нет</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {admin.createdAt.toLocaleDateString('ru-RU')}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/users/${admin.userId}`}
                        className="text-[#F97316] hover:text-[#EA580C] text-xs"
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
