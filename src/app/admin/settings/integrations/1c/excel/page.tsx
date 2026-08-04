import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { ImportForm } from '@/components/import/import-form';

export const metadata: Metadata = { title: 'Загрузка Excel · Обмен с 1С · Настройки' };

export const dynamic = 'force-dynamic';

export default async function AdminImportPage() {
  await requireSettingsSection('integrations.oneC', 'admin');
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
        Это не то же самое, что «Импорт выписки (сч. 51)»: там загружается банковская выписка одним
        листом. А постоянный автоматический обмен с 1С по сети настраивается в разделе
        «Синхронизация (авто)».
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <ImportForm />
      </div>
    </div>
  );
}
