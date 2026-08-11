import { redirect } from 'next/navigation';

/**
 * `У-46` (этап 7): «Синхронизация» переехала вкладкой внутрь «Обмена с 1С».
 * Прежний адрес оставлен рабочим — на него есть закладки и ссылки в письмах;
 * страница-шлюз ведёт на новое место, а не отдаёт 404.
 */
export default function AdminSyncLegacyPage() {
  redirect('/admin/settings/integrations/1c/auto');
}
