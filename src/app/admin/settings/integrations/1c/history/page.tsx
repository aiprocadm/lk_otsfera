import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listExchangeHistory } from '@/lib/services/import/history';
import { ExchangeHistory } from '@/components/import/exchange-history';

export const metadata: Metadata = { title: 'История обмена · Обмен с 1С' };
export const dynamic = 'force-dynamic';

/**
 * Вкладка «История» (`У-48`, этап 7) — общая для всех каналов обмена.
 * Скоуп режет сервис: руководитель видит только свою компанию, автообмен ему
 * не показывается вовсе (в `SyncLog` нет компании).
 */
export default async function AdminOneCHistoryPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');
  const res = await listExchangeHistory(prisma, session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#111111]">История обмена</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Что загружали и когда — по всем каналам сразу: файлы Excel, выписки и автообмен.
        </p>
      </div>
      {res.ok ? (
        <ExchangeHistory items={res.items} />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав, чтобы смотреть историю обмена.
        </p>
      )}
    </div>
  );
}
