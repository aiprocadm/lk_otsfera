/**
 * Адреса раздела миграции в одном месте: их знают и вкладки, и список пакетов,
 * и форма нового пакета, и server actions (для `revalidatePath`). Разъехавшийся
 * адрес — это «кнопка ведёт не туда», которую никто не замечает до релиза.
 */
export const BITRIX_ROOT = '/admin/settings/integrations/bitrix';
export const BITRIX_BATCHES = `${BITRIX_ROOT}/history`;

export function batchHref(batchId: string): string {
  return `${BITRIX_BATCHES}/${batchId}`;
}

/** Отчёт сверки пакета — подписанная ссылка выдаётся роутом (`У-198`). */
export const reportHref = (batchId: string): string => `/api/admin/bitrix/${batchId}/report`;
