'use client';
import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import {
  checkWebhookAction,
  sendSelfTestMessageAction,
} from '@/server-actions/admin/integrationSettings';
import type { MessengerChannel } from '@/lib/services/messengers/channels';

/**
 * Две кнопки проверки канала (`У-213`): наружу и внутрь.
 *
 * Результат печатается тут же, рядом с кнопкой, а не тостом: человек нажимает
 * их именно тогда, когда что-то не работает, и ответ ему нужно перечитать, а
 * не поймать за три секунды.
 */
const LABEL: Record<string, string> = {
  not_linked:
    'У вашей учётной записи не привязан этот мессенджер — привяжите его в личных настройках.',
  channel_unavailable: 'Канал не подключён или проверка для него недоступна.',
  forbidden: 'Недостаточно прав.',
  failed: 'Не удалось выполнить проверку.',
};

export function ChannelCheckButtons({ channel }: { channel: MessengerChannel }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(kind: 'test' | 'webhook') {
    setMessage(null);
    startTransition(async () => {
      const action = kind === 'test' ? sendSelfTestMessageAction : checkWebhookAction;
      const result = await action(channel, new FormData());
      if (result.ok) {
        setMessage({ ok: true, text: result.detail });
        return;
      }
      // Причина от провайдера точнее общей подписи — показываем её.
      setMessage({
        ok: false,
        text: result.reason ?? LABEL[result.error] ?? 'Проверка не удалась.',
      });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run('test')}>
        Тестовое сообщение себе
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run('webhook')}>
        Проверить вебхук
      </Button>
      {message && (
        <span
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-xs text-green-700' : 'text-xs text-red-600'}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
