import { redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Корень раздела «Обмен с 1С» (`У-113`): открывает первую вкладку.
 *
 * Пункт меню ведёт сюда, а не сразу на вкладку, чтобы адрес раздела оставался
 * коротким и не менялся при перестановке вкладок.
 */
export default async function ManagerExchangePage() {
  await requireManager();
  redirect('/manager/exchange/excel');
}
