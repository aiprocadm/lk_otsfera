import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';
import { IntegrationsHealthPanel } from '@/components/admin/integrations-health-panel';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Интеграции · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Интеграции» руководителя (`У-135`, решение `Р-22`): светофор и чек-листы —
 * **без секретов платформы**.
 *
 * У администратора на этом же разделе живут формы подключений с ключами и
 * токенами. Руководителю они не показываются и не доступны: страница не
 * запрашивает ни одной настройки — только статусы проверок. Переключатели
 * флагов тоже спрятаны (`flagEditable: false` на каждой строке): флаги
 * платформы переключает администратор, а кнопка, которая вернёт отказ, хуже
 * её отсутствия.
 */
export default async function LeaderIntegrationsPage() {
  const session = await requireSettingsSection('integrations.overview', 'leader');
  const health = await getIntegrationsHealth(prisma, session);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Интеграции"
        subtitle="Состояние подключений платформы: 1С, почта, телефония, боты. Настраивает их администратор."
      />

      {health.ok ? (
        <IntegrationsHealthPanel
          rows={health.rows.map((r) => ({ ...r, flagEditable: false }))}
          lockedLabel="переключает администратор"
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав для просмотра состояния интеграций.
        </p>
      )}

      <p className="text-xs text-gray-400">
        Ключи, токены и параметры подключений задаёт администратор платформы. Если какая-то
        интеграция «не настроена» и она вам нужна — обратитесь к нему.
      </p>
    </div>
  );
}
