import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { listExchangeHistory } from '@/lib/services/import/history';
import { ExchangeHistory } from '@/components/import/exchange-history';

export const dynamic = 'force-dynamic';

/**
 * Вкладка «История» раздела «Обмен с 1С» (`У-113`, `У-48`).
 *
 * Общая для всех каналов: что загружали и когда. Скоуп режет сервис — менеджер
 * видит только свои загрузки, а автообмен ему не показывается вовсе (в журнале
 * автообмена нет компании, и показать его значило бы отдать чужие данные).
 */
export default async function ManagerExchangeHistoryPage() {
  const session = await requireManager();
  const res = await listExchangeHistory(prisma, session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#111111]">История обмена</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Что загружали и когда — файлы Excel и банковские выписки в одном списке.
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
