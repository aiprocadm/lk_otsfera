'use client';

import React, { useState, useTransition } from 'react';
import { resetSettingToServerValueAction } from '@/server-actions/admin/integrationSettings';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';

/**
 * «Использовать значение сервера» (`У-131`).
 *
 * Значение, введённое в интерфейсе, перекрывает переменную окружения — и убрать
 * его было нельзя: пустое поле у секрета означает «не менять», а не «стереть».
 * Единственным способом вернуться к серверному значению была правка базы
 * руками.
 *
 * Кнопка появляется только там, где перекрытие реально есть (`source === 'db'`):
 * предлагать «вернуть серверное» там, где ничего не перекрыто, — врать
 * человеку.
 */
export function ResetSettingButton({ settingKey, label }: { settingKey: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function doReset() {
    startTransition(async () => {
      const res = await resetSettingToServerValueAction(settingKey);
      setConfirming(false);
      if (res.ok) {
        toast.success(`«${label}»: снова действует значение сервера.`);
        return;
      }
      toast.error(errorMessageRu(res.error));
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="ml-2 text-xs text-gray-500 underline hover:text-[#EA580C]"
      >
        использовать значение сервера
      </button>
    );
  }

  return (
    <span className="ml-2 text-xs">
      <span className="text-gray-600">Убрать заданное здесь значение?</span>{' '}
      <button
        type="button"
        onClick={doReset}
        disabled={pending}
        className="text-[#EA580C] underline disabled:opacity-50"
      >
        {pending ? 'убираем…' : 'да'}
      </button>{' '}
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="text-gray-500 underline disabled:opacity-50"
      >
        отмена
      </button>
    </span>
  );
}
