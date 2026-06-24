'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  generateTelegramLinkAction,
  unlinkTelegramAction,
} from '@/server-actions/telegram';

type Props = {
  status: { linked: boolean; enabled: boolean };
};

export function TelegramLinkCard({ status }: Props) {
  const router = useRouter();
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!status.enabled) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-500">Telegram</h2>
        <p className="mt-1 text-sm text-gray-400">
          Telegram-уведомления пока не настроены администратором.
        </p>
      </div>
    );
  }

  if (status.linked) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Telegram</h2>
            <Badge tone="success">Telegram привязан</Badge>
          </div>
          <Button
            variant="danger"
            size="sm"
            loading={isPending}
            onClick={() => {
              startTransition(async () => {
                await unlinkTelegramAction();
                toast.success('Telegram отвязан');
                router.refresh();
              });
            }}
          >
            Отвязать
          </Button>
        </div>
      </div>
    );
  }

  // enabled && !linked
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Telegram</h2>
      {deepLink ? (
        <div className="space-y-2">
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-[#F97316] underline break-all"
          >
            Открыть в Telegram
          </a>
          <p className="text-sm text-gray-500">
            Откройте ссылку и нажмите Старт в Telegram, затем обновите страницу.
          </p>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          loading={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await generateTelegramLinkAction();
              if (result.ok) {
                setDeepLink(result.deepLink);
              } else {
                toast.error(errorMessageRu(result.error, 'Не удалось создать ссылку.'));
              }
            });
          }}
        >
          Привязать Telegram
        </Button>
      )}
    </div>
  );
}
