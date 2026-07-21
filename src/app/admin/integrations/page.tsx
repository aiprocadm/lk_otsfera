import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getIntegrationsStatus } from '@/lib/services/admin/integrations';

export const dynamic = 'force-dynamic';

export default async function AdminIntegrationsPage() {
  await requireAdmin();
  const integrations = getIntegrationsStatus();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Интеграции</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Статус внешних сервисов платформы: телефония, мессенджеры и обмен с 1С.
        </p>
      </div>

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">ℹ️</span>
        Это только просмотр статуса. Ключи и токены настраиваются администратором
        сервера в конфигурации (env) при установке — здесь их ввести нельзя, это
        сделано ради безопасности.
      </div>

      <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {integrations.map((it) => (
          <li key={it.key} className="px-4 py-3.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[#111111] text-sm">{it.label}</span>
                {it.enabled ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                    Подключено
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                    Не настроено
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{it.description}</div>
              <div className="text-xs text-gray-400 mt-1 font-mono">{it.envHint}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
