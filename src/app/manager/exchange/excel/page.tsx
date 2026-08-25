import React from 'react';
import { redirect } from 'next/navigation';
import LeaderImportPage from '@/app/leader/settings/integrations/1c/excel/page';
import { requireManager } from '@/lib/auth/requireRole';
import { isManagerLeader, mayImportOneC } from '@/lib/auth/managerPolicy';
import { ImportForm } from '@/components/import/import-form';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/**
 * Вкладка «Загрузка Excel» раздела «Обмен с 1С» (`У-113`).
 *
 * История загрузок переехала на свою вкладку — на экране не должно быть
 * двух историй.
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
export default async function ManagerExchangeExcelPage() {
  const session = await requireManager();
  // Руководитель ведёт обмен в своём хабе настроек — там же расписания и общая
  // история; дублировать их во второй экран нельзя (`У-118`).
  if (isManagerLeader(session)) return LeaderImportPage();
  if (!mayImportOneC(session)) redirect('/forbidden');

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Загрузка Excel из 1С"
          subtitle="Разовая ручная загрузка «чистого» Excel-файла из 1С с тремя листами: «Контрагенты», «Реализации», «Поступления». Предпросмотр покажет план изменений до применения."
        />
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
    </div>
  );
}
