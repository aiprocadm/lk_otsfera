import { redirect } from 'next/navigation';

/**
 * `У-114`: раздел «Личная безопасность» слит с соседним в «Личные настройки».
 * Старый адрес остаётся живым и приводит на свою вкладку — закладки не ломаем.
 */
export default function AdminPersonalSecurityRedirect() {
  redirect('/admin/settings/personal?tab=security');
}
