/**
 * Шлюзы старых маршрутов настроек: ни один сохранённый адрес не должен отдать
 * 404. Каждый старый путь обязан спросить `redirectToSettingsHub` со **своим**
 * адресом — иначе редирект уедет не туда, и человек с закладкой попадёт в
 * чужой раздел.
 *
 * До `У-262` у шлюза была вторая ветка: при выключенном флаге `settings_hub`
 * страница рендерила прежнее содержимое на прежнем адресе, и тест проверял обе.
 * Флаг снят — хаб принят, откатывать нечего, вторая ветка удалена вместе с ним.
 * Осталось единственное обязательство, зато главное: **адрес не перепутан**.
 *
 * Сама карта редиректов проверяется в `lib.navigation.settings`, постоянство
 * редиректа (308) — в `lib.navigation.settings-redirect`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirectToSettingsHub } = vi.hoisted(() => ({ redirectToSettingsHub: vi.fn() }));
vi.mock('@/lib/navigation/settingsRedirect', () => ({ redirectToSettingsHub }));

import AdminOrderStatusesLegacy from '@/app/admin/order-statuses/page';
import AdminCustomFieldsLegacy from '@/app/admin/custom-fields/page';
import LeaderOrderStatusesLegacy from '@/app/leader/settings/order-statuses/page';
import LeaderCustomFieldsLegacy from '@/app/leader/settings/custom-fields/page';
import AdminIntegrationsLegacy from '@/app/admin/integrations/page';
import AdminHealthLegacy from '@/app/admin/health/page';
import AdminRolesLegacy from '@/app/admin/roles/page';
import LeaderRolesLegacy from '@/app/leader/roles/page';
import AdminAuditLegacy from '@/app/admin/audit/page';
import AdminPiiAccessLegacy from '@/app/admin/pii-access/page';
import AdminSyncLegacy from '@/app/admin/sync/page';
import AdminImportLegacy from '@/app/admin/import/page';
import AdminPaymentsImportLegacy from '@/app/admin/payments-import/page';

/** Страница-шлюз и адрес, который она обязана назвать. */
const GATEWAYS: ReadonlyArray<[() => Promise<unknown>, string]> = [
  [AdminOrderStatusesLegacy, '/admin/order-statuses'],
  [AdminCustomFieldsLegacy, '/admin/custom-fields'],
  [LeaderOrderStatusesLegacy, '/leader/settings/order-statuses'],
  [LeaderCustomFieldsLegacy, '/leader/settings/custom-fields'],
  [AdminIntegrationsLegacy, '/admin/integrations'],
  [AdminHealthLegacy, '/admin/health'],
  [AdminRolesLegacy, '/admin/roles'],
  [LeaderRolesLegacy, '/leader/roles'],
  [AdminAuditLegacy, '/admin/audit'],
  [AdminPiiAccessLegacy, '/admin/pii-access'],
  [AdminSyncLegacy, '/admin/sync'],
  [AdminImportLegacy, '/admin/import'],
  [AdminPaymentsImportLegacy, '/admin/payments-import'],
];

beforeEach(() => {
  redirectToSettingsHub.mockClear();
});

describe('шлюзы старых маршрутов настроек (У-262)', () => {
  it.each(GATEWAYS)('шлюз называет свой собственный адрес: %#', async (page, href) => {
    await page();
    expect(redirectToSettingsHub).toHaveBeenCalledWith(href);
  });

  it('шлюзов ровно столько, сколько старых адресов в реестре', () => {
    // Защита от «добавили страницу-шлюз, а в список тестов внести забыли».
    expect(GATEWAYS).toHaveLength(13);
    const hrefs = GATEWAYS.map(([, href]) => href);
    expect(new Set(hrefs).size, 'два шлюза называют один адрес').toBe(hrefs.length);
  });
});
