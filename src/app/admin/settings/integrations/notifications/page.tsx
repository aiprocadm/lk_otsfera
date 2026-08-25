import { redirect } from 'next/navigation';

/**
 * `У-114`: раздел «Каналы уведомлений» слит с соседним в «Личные настройки».
 * Старый адрес остаётся живым и приводит на свою вкладку — закладки не ломаем.
 */
export default function AdminNotificationChannelsRedirect() {
  redirect('/admin/settings/personal?tab=notifications');
}
