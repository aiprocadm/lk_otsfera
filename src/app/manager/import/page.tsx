import { requireManager } from '@/lib/auth/requireRole';
import { ImportForm } from '@/components/import/import-form';

export default async function ManagerImportPage() {
  await requireManager();
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-[#111111]">Загрузка данных из 1С</h1>
      <p className="text-sm text-gray-500 mb-6">
        Загрузите файл Excel, сформированный в 1С. Сначала выполняется предварительная проверка —
        вы увидите план изменений до их применения.
      </p>
      <ImportForm />
    </>
  );
}
