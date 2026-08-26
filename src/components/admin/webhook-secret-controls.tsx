'use client';

import React, { useState, useTransition } from 'react';
import {
  generateWebhookSecretAction,
  registerWebhookAction,
} from '@/server-actions/admin/integrationSettings';
import { toast } from '@/lib/ui/toast';

/**
 * «Сгенерировать секрет» и «Зарегистрировать вебхук» (`У-123`).
 *
 * Секрет вебхука жил только в переменной сервера — подключить бота без доступа
 * к серверу было нельзя. Теперь секрет придумывает система: значение
 * показывается **один раз**, потому что дальше хранится зашифрованным и
 * прочитать его нельзя даже администратору.
 *
 * Кнопка «Зарегистрировать» показывается только там, где у провайдера есть на
 * это API. У WhatsApp-агрегатора адрес задаётся в его личном кабинете, и
 * кнопка, которая ничего не делает, была бы хуже её отсутствия.
 */
const REGISTER_ERRORS: Record<string, string> = {
  not_supported: 'Этот провайдер не умеет регистрировать вебхук по API — задайте адрес у него.',
  no_token: 'Сначала сохраните токен бота.',
  no_secret: 'Сначала сгенерируйте секрет вебхука.',
  provider_error: 'Провайдер не принял адрес. Проверьте токен и доступность сайта извне.',
  validation: 'Неизвестный провайдер.',
};

export function WebhookSecretControls({
  provider,
  canRegister,
}: {
  provider: string;
  canRegister: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  function generate() {
    startTransition(async () => {
      const res = await generateWebhookSecretAction(provider);
      if (!res.ok) {
        toast.error(
          res.error === 'secrets_key_missing'
            ? 'На сервере не задан ключ шифрования — секрет сохранить нельзя.'
            : 'Не удалось сгенерировать секрет.'
        );
        return;
      }
      setFreshSecret(res.secret);
    });
  }

  function register() {
    startTransition(async () => {
      const res = await registerWebhookAction(provider);
      if (res.ok) {
        toast.success(res.message);
        return;
      }
      toast.error(REGISTER_ERRORS[res.error] ?? 'Не удалось зарегистрировать вебхук.');
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="text-xs font-medium text-[#F97316] border border-[#F97316] hover:bg-[#FFF7ED] rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {pending ? 'Работаем…' : 'Сгенерировать секрет'}
        </button>
        {canRegister && (
          <button
            type="button"
            onClick={register}
            disabled={pending}
            className="text-xs font-medium text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            Зарегистрировать вебхук
          </button>
        )}
      </div>

      {freshSecret && (
        <div
          role="status"
          className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1"
        >
          <div className="font-medium text-amber-900">
            Новый секрет — скопируйте его сейчас, второй раз он не покажется.
          </div>
          <div className="font-mono break-all text-[#111111]">{freshSecret}</div>
          <div className="text-amber-800">
            Секрет уже сохранён. Дальше он хранится зашифрованным, и прочитать его нельзя —
            только сгенерировать новый.
          </div>
        </div>
      )}
    </div>
  );
}
