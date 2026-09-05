import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isRouteGatedFlag, isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { getThresholds } from '@/lib/monitoring/thresholds';
import { countFailedDocumentPushes } from '@/lib/services/oneCSync/pushFailures';
import { getIntegrationsStatus, listIntegrationSyncStates } from './integrations';

/**
 * Светофор интеграций (`У-70`) и включение каналов оттуда же, где вводятся
 * ключи (`У-69`).
 *
 * Данные для светофора уже собирались: проба «Проверить подключение» пишет в
 * `SyncState` дату запуска, дату успеха и текст последней ошибки. Не хватало
 * ровно двух вещей — свести это в одно состояние и показать рядом с карточкой.
 *
 * Состояний **пять**, хотя ТЗ называет три. Четвёртое — «настроено, но
 * проверка ни разу не запускалась»: сваливать его в «работает» значило бы
 * обещать работоспособность, которую никто не проверял, а в «не настроено» —
 * врать про ключи. Молчание тут хуже лишнего слова (§15). Пятое — «работает
 * с ошибками» (`У-174`): подключение отвечает, но документов, которые 1С не
 * приняла, больше порога `alerts.oneCPushFailedMax`. Зелёный светофор при
 * десятке невыгруженных счетов обещал бы то, чего нет.
 */
export type IntegrationHealthStatus = 'ok' | 'error' | 'not_configured' | 'unchecked' | 'degraded';

export type IntegrationHealthRow = {
  key: string;
  label: string;
  description: string;
  status: IntegrationHealthStatus;
  /** Когда последний раз проверяли (ISO) — `null`, если не проверяли ни разу. */
  lastCheckedAt: string | null;
  /** Текст последней ошибки — показывается человеку как есть (`У-70`). */
  lastError: string | null;
  /**
   * Флаг канала, если включение зависит от него (`У-69`). `null` — канал
   * включается наличием ключей, отдельного переключателя нет.
   */
  flag: FeatureFlag | null;
  flagEnabled: boolean;
  /** Можно ли переключить флаг здесь же. `false` — флаг раздела (за сервером). */
  flagEditable: boolean;
  /**
   * `У-174`: «документов не выгружено: N» — только у карточки 1С, у остальных
   * `null`. Считается в охвате смотрящего: руководитель видит свою компанию.
   */
  documentsNotPushed: { count: number; threshold: number } | null;
};

/** Какие карточки несут переключатель канала (`У-69`). */
const CHANNEL_FLAGS: Record<string, FeatureFlag> = {
  max: 'max_channel',
  whatsapp: 'whatsapp_channel',
  mango: 'telephony_mango',
};

export async function getIntegrationsHealth(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; rows: IntegrationHealthRow[] } | { ok: false; error: 'forbidden' }> {
  // `У-135` (решение `Р-22`): светофор открыт и руководителю — в строках нет
  // секретов, только статусы, времена проверок и тексты ошибок. Секреты живут
  // в формах админской страницы, куда руководитель не попадает.
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }

  // Статус читает креды через кэш настроек — праймим до вызова (заодно
  // подтягиваются значения флагов, они лежат в той же таблице).
  await primeIntegrationSettingsCache(prisma);
  const statuses = getIntegrationsStatus();
  const [states, failedPushes] = await Promise.all([
    listIntegrationSyncStates(
      prisma,
      statuses.map((s) => `integration.${s.key}`)
    ),
    // Админ — всю платформу; руководитель — свою компанию (`У-135`), а без
    // компании считать нечего: пусто, а не «всё» (C8: null → deny-all).
    session.role === 'admin'
      ? countFailedDocumentPushes(prisma)
      : session.companyId
        ? countFailedDocumentPushes(prisma, { companyId: session.companyId })
        : Promise.resolve(0),
  ]);
  const documentsNotPushed = { count: failedPushes, threshold: getThresholds().oneCPushFailedMax };

  return {
    ok: true,
    rows: statuses.map((s) => {
      const state = states.find((x) => x.entity === `integration.${s.key}`);
      const flag = CHANNEL_FLAGS[s.key] ?? null;
      const isOneC = s.key === 'onec';
      return {
        key: s.key,
        label: s.label,
        description: s.description,
        status: isOneC
          ? withPushFailures(statusOf(s.enabled, state), documentsNotPushed)
          : statusOf(s.enabled, state),
        lastCheckedAt: state?.lastRunAt ? state.lastRunAt.toISOString() : null,
        lastError: state?.lastError ?? null,
        flag,
        flagEnabled: flag ? isFeatureEnabled(flag) : false,
        flagEditable: flag ? !isRouteGatedFlag(flag) : false,
        documentsNotPushed: isOneC ? documentsNotPushed : null,
      };
    }),
  };
}

/**
 * `У-174`: «работает» превращается в «работает с ошибками», когда невыгруженных
 * документов больше порога. Остальные состояния сильнее: «ошибка» и «не
 * настроено» и так объясняют, почему документы не уезжают.
 */
function withPushFailures(
  status: IntegrationHealthStatus,
  pushes: { count: number; threshold: number }
): IntegrationHealthStatus {
  return status === 'ok' && pushes.count > pushes.threshold ? 'degraded' : status;
}

function statusOf(
  configured: boolean,
  state:
    { lastRunAt: Date | null; lastSuccessAt: Date | null; lastError: string | null } | undefined
): IntegrationHealthStatus {
  if (!configured) return 'not_configured';
  if (!state?.lastRunAt) return 'unchecked';
  // Успешной считается проба, чей запуск совпал с успехом — так же, как это
  // считает существующая панель проверок.
  const lastOk =
    !!state.lastSuccessAt && state.lastRunAt.getTime() === state.lastSuccessAt.getTime();
  return lastOk ? 'ok' : 'error';
}
