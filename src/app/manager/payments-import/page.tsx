import { redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Шлюз со старого адреса выписки по счёту 51 (`У-113`).
 *
 * Обмен с 1С стал одним разделом с вкладками. Прежний адрес не удаляем: по
 * нему остались закладки и ссылки в инструкциях.
 */
export default async function ManagerPaymentsImportGatewayPage() {
  await requireManager();
  redirect('/manager/exchange/payments');
}
