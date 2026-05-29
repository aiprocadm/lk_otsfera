import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { PartnerCreateForm } from '@/components/admin/partner-create-form';

export const dynamic = 'force-dynamic';

export default async function NewPartnerPage() {
  await requireAdmin();
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/admin/partners" className="text-xs text-gray-500 hover:text-[#F97316]">
          ← К списку
        </Link>
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Новый партнёр</h1>
      </div>
      <PartnerCreateForm />
    </div>
  );
}
