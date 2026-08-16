import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { ImportForm } from '@/components/import/import-form';
import { ImportHistory } from '@/components/import/import-history';
import { listImportBatches } from '@/lib/services/import/rollback';

export const metadata: Metadata = { title: 'Загрузка Excel · Обмен с 1С · Настройки' };

export const dynamic = 'force-dynamic';

export default async function AdminImportPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');
  // Т-41: admin (Model A) выбирает, в какую компанию привязывать НОВЫЕ
  // организации; единственная компания подставится по умолчанию без вопроса.
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  // Этап 9 (Т-39): история импортов с кнопкой отката.
  const history = await listImportBatches(prisma, session);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Загрузка Excel из 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Разовая ручная загрузка «чистого» Excel-файла из 1С с тремя листами: «Контрагенты»,
          «Реализации», «Поступления». Загружает заказы и оплаты. Предпросмотр покажет план
          изменений до применения.
        </p>
      </div>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Это не то же самое, что «Импорт оплат»: там загружается банковская выписка одним
        листом. А постоянный автоматический обмен с 1С по сети настраивается в разделе
        «Синхронизация (авто)».
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <ImportForm companies={companies} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-[#111111] mb-3">История импортов</h2>
        <ImportHistory batches={history.ok ? history.batches : []} />
      </div>
    </div>
  );
}
