/**
 * Адреса, которых больше нет (`У-263`, прогон сопровождения №37, 23.09.2026).
 *
 * **Что было.** Разделы переезжали, а старый адрес оставался «шлюзом» — пустой
 * страницей, которая уводила на новое место, чтобы закладка не отдала 404.
 * Требование давало шлюзу 90 дней; заказчик 23.09.2026 решил срок не ждать.
 * Шлюзы удалены, старый адрес теперь отвечает общей страницей 404 «раздел
 * переехал» с кнопкой в кабинет.
 *
 * **Зачем список, если страниц нет.** Удалённый адрес опасен тем, что на него
 * легко сослаться снова: в памяти людей и в старом коде он живёт дольше
 * страницы. Список замороженный — он не растёт вместе с переездами и не
 * обещает редиректа, он только помнит, куда ходить нельзя:
 *
 * - страж `navigation.no-gateway-links` падает, если код ведёт сюда;
 * - страж `navigation.legacy-gateways` падает, если здесь снова появилась
 *   страница (переезд обратно — это новое решение, а не «вернули шлюз»);
 * - ссылка уведомления, сохранённая в базе (`meta.url`), на такой адрес не
 *   ведёт — вместо неё строится ссылка по таблице маршрутов (`href.ts`);
 * - `npm run report:legacy-links` ищет эти адреса в данных базы.
 */
export type RemovedPath = {
  /**
   * Прежний адрес. Удалён вместе со всем, что под ним: у `/partner/deals`
   * была и карточка `/partner/deals/<id>`.
   */
  path: string;
  /** Где раздел живёт теперь — подсказка тому, кто правит ссылку. */
  movedTo: string;
};

export const REMOVED_PATHS: readonly RemovedPath[] = [
  // ── Кабинеты ──
  { path: '/organization/students', movedTo: '/organization/company?tab=employees' },
  { path: '/organization/team', movedTo: '/organization/company?tab=settings' },
  { path: '/manager/students', movedTo: '/manager/organizations' },
  { path: '/manager/team', movedTo: '/leader/team' },
  { path: '/manager/import', movedTo: '/manager/exchange/excel' },
  { path: '/manager/payments-import', movedTo: '/manager/exchange/payments' },
  { path: '/partner/deals', movedTo: '/partner/orders' },
  { path: '/partner/team', movedTo: '/partner/settings?tab=team' },
  // ── Служебные разделы, переехавшие в хаб «Настройки» ──
  { path: '/admin/integrations', movedTo: '/admin/settings/integrations' },
  { path: '/admin/import', movedTo: '/admin/settings/integrations/1c/excel' },
  { path: '/admin/payments-import', movedTo: '/admin/settings/integrations/1c/payments' },
  { path: '/admin/sync', movedTo: '/admin/settings/integrations/1c/auto' },
  { path: '/admin/order-statuses', movedTo: '/admin/settings/catalogs/application-statuses' },
  {
    path: '/leader/settings/order-statuses',
    movedTo: '/leader/settings/catalogs/application-statuses',
  },
  { path: '/admin/custom-fields', movedTo: '/admin/settings/catalogs/custom-fields' },
  { path: '/leader/settings/custom-fields', movedTo: '/leader/settings/catalogs/custom-fields' },
  { path: '/admin/roles', movedTo: '/admin/settings/access/roles' },
  { path: '/leader/roles', movedTo: '/leader/settings/access/roles' },
  { path: '/admin/audit', movedTo: '/admin/settings/security/audit' },
  { path: '/admin/pii-access', movedTo: '/admin/settings/security/personal-data' },
  { path: '/admin/health', movedTo: '/admin/settings/system/health' },
  // ── Переезды внутри хаба ──
  // Эти шлюзы не стояли ни в одном реестре — страж срока их не видел, и они
  // остались бы навсегда. Нашлись при удалении по признаку «страница только
  // уводит».
  { path: '/admin/settings/integrations/sync', movedTo: '/admin/settings/integrations/1c/auto' },
  {
    path: '/admin/settings/integrations/notifications',
    movedTo: '/admin/settings/personal?tab=notifications',
  },
  {
    path: '/leader/settings/integrations/notifications',
    movedTo: '/leader/settings/personal?tab=notifications',
  },
  { path: '/admin/settings/security/personal', movedTo: '/admin/settings/personal?tab=security' },
  {
    path: '/leader/settings/security/personal',
    movedTo: '/leader/settings/personal?tab=security',
  },
];

/**
 * Ведёт ли локальный адрес (с хвостом `?…` или `#…` или без) в удалённый
 * раздел. Граница — целый сегмент: `/admin/settings/security/personal-data`
 * живой раздел, хотя начинается с удалённого `/admin/settings/security/personal`.
 */
export function isRemovedPath(href: string): boolean {
  const pathname = href.replace(/[?#][\s\S]*$/, '');
  return REMOVED_PATHS.some(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
}
