import React from 'react';
import { redirect } from 'next/navigation';
import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderImportPage from '@/app/leader/settings/integrations/1c/excel/page';
import { requireManager } from '@/lib/auth/requireRole';
import { isManagerLeader, mayImportOneC } from '@/lib/auth/managerPolicy';
import { prisma } from '@/lib/db/prisma';
import { ImportForm } from '@/components/import/import-form';
import { ImportHistory } from '@/components/import/import-history';
import { listImportBatches } from '@/lib/services/import/rollback';

export const dynamic = 'force-dynamic';

/**
 * Загрузка Excel из 1С в кабинете менеджера.
 *
 * **Решение заказчика 11.08.2026:** импорт доступен администратору,
 * руководителю и обычному менеджеру. До этого страница отбивала обычного
 * менеджера в `/forbidden`.
 *
 * Руководителя по-прежнему уводим в его хаб настроек (там же вкладки и общая
 * история). У обычного менеджера хаба нет, поэтому страница живёт здесь и
 * рисуется на месте. Границу видимости режет не экран, а скоуп: менеджер
 * работает только со своими организациями и НЕ может создать новую (§4).
 */
export default async function ManagerImportPage() {
  const session = await requireManager();
  if (isManagerLeader(session)) {
    redirectToSettingsHub('/manager/import');
    return LeaderImportPage();
  }
  if (!mayImportOneC(session)) redirect('/forbidden');

  const history = await listImportBatches(prisma, session);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Загрузка Excel из 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Разовая ручная загрузка «чистого» Excel-файла из 1С с тремя листами: «Контрагенты»,
          «Реализации», «Поступления». Предпросмотр покажет план изменений до применения.
        </p>
      </div>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Загрузка идёт в рамках закреплённых за вами организаций. Строки по незнакомым организациям
        новую карточку не заводят — их разбирает руководитель или администратор.
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <ImportForm />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#111111] mb-3">История импортов</h2>
        <ImportHistory batches={history.ok ? history.batches : []} />
      </div>
    </div>
  );
}
