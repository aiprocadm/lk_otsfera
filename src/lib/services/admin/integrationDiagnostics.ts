import type { PrismaClient } from '@prisma/client';
import { fmtDateTime } from '@/lib/format';
import { getAppBaseUrl } from '@/lib/notifications/shared';
import { listIntegrationSyncStates } from './integrations';
import { INTEGRATION_TEST_KEYS, type IntegrationTestKey } from './testIntegration';
import { WEBHOOK_PROVIDERS, isWebhookProvider } from './webhookSecrets';

/**
 * Диагностика подключений для карточек настроек (ФТ-14.3/14.4): итог последней
 * пробы «Проверить подключение» и отметка «последнее входящее» вебхука.
 *
 * Жила замыканиями внутри обзорной страницы «Интеграции». Спека 2026-09-12
 * (Р-М-6) выносит формы мессенджеров в свой раздел «Подключение мессенджеров»
 * — той же диагностике нужны обе страницы, поэтому она здесь, а не
 * скопирована (jscpd) и не импортирована страницей у страницы (§2).
 */

/** Итог последней пробы подключения (SyncState `integration.<key>`), даты отформатированы. */
export type IntegrationCheckInfo = {
  lastAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
};

/** Диагностика вебхука (SyncState `webhook.<name>`): подсказка регистрации + последнее входящее. */
export type WebhookDiagInfo = {
  url: string;
  /**
   * Ключ провайдера для действий с секретом (`У-123`). Необязательный: у
   * провайдера без генерируемого нами секрета (Mango — `apiSalt` выдаёт он
   * сам) кнопок быть не должно.
   */
  provider?: string | undefined;
  /** Есть ли у провайдера API регистрации вебхука. */
  canRegister?: boolean | undefined;
  /** Имя секрет-заголовка; null — аутентификация не заголовком (например подпись Mango). */
  headerName: string | null;
  secretSet: boolean;
  lastEventAt: string | null;
  note?: string | undefined;
};

export type WebhookName = 'telegram' | 'max' | 'whatsapp' | 'mango';

export type IntegrationDiagnostics = {
  checkOf: (key: IntegrationTestKey) => IntegrationCheckInfo | null;
  webhookOf: (
    name: WebhookName,
    headerName: string | null,
    secretSet: boolean,
    note?: string
  ) => WebhookDiagInfo;
};

/**
 * Один запрос к `SyncState` на страницу: пробы всех интеграций плюс вебхуки,
 * которые эта страница показывает.
 */
export async function loadIntegrationDiagnostics(
  prisma: PrismaClient,
  webhooks: readonly WebhookName[]
): Promise<IntegrationDiagnostics> {
  const syncStates = await listIntegrationSyncStates(prisma, [
    ...INTEGRATION_TEST_KEYS.map((k) => `integration.${k}`),
    ...webhooks.map((n) => `webhook.${n}`),
  ]);
  const stateOf = (entity: string) => syncStates.find((s) => s.entity === entity);
  const appUrl = getAppBaseUrl();

  return {
    checkOf(key) {
      const s = stateOf(`integration.${key}`);
      if (!s?.lastRunAt) return null;
      const lastOk = !!s.lastSuccessAt && s.lastRunAt.getTime() === s.lastSuccessAt.getTime();
      return { lastAt: fmtDateTime(s.lastRunAt), lastOk, lastError: s.lastError };
    },
    webhookOf(name, headerName, secretSet, note) {
      const s = stateOf(`webhook.${name}`);
      // `У-123`: кнопки генерации показываем только у провайдеров, чей секрет
      // придумываем мы. У Mango это `apiSalt` от провайдера — генерировать его
      // нельзя, поэтому его здесь нет.
      const managed = isWebhookProvider(name) ? WEBHOOK_PROVIDERS[name] : null;
      return {
        url: `${appUrl}/api/integrations/${name}/webhook`,
        headerName,
        secretSet,
        lastEventAt: s?.lastSuccessAt ? fmtDateTime(s.lastSuccessAt) : null,
        note,
        ...(managed ? { provider: name, canRegister: managed.canRegister } : {}),
      };
    },
  };
}
