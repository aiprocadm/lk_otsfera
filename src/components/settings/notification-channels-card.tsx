'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type { NotificationSettingsView } from '@/lib/services/notifications/preferences';
import { generateMaxLinkAction, unlinkMaxAction } from '@/server-actions/max';
import {
  saveWhatsappPhoneAction,
  updateChannelPreferenceAction,
} from '@/server-actions/notification-channels';

type Props = { settings: NotificationSettingsView };

/**
 * Единая карточка настроек каналов уведомлений (D2). Domain-agnostic: получает
 * только `NotificationSettingsView` из сессии, роль-специфики нет. Email —
 * «всегда включён». Telegram/Max — привязка + мьют-toggle. WhatsApp — номер +
 * toggle. Карточки каналов Max/WhatsApp скрыты, если канал не включён
 * администратором (флаг + креды).
 */
export function NotificationChannelsCard({ settings }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phone, setPhone] = useState(settings.whatsapp.phone ?? '');
  const [maxDeepLink, setMaxDeepLink] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  function toggle(channel: 'telegram' | 'max' | 'whatsapp', enabled: boolean) {
    startTransition(async () => {
      const result = await updateChannelPreferenceAction(channel, enabled);
      if (result.ok) {
        toast.success(enabled ? 'Канал включён' : 'Канал выключен');
        router.refresh();
      } else {
        toast.error(errorMessageRu(result.error));
      }
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Каналы уведомлений</h2>

      {/* Email — базовый канал, не отключается */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Email</p>
          <p className="text-xs text-gray-400">Базовые события всегда приходят на почту.</p>
        </div>
        <Badge tone="success">Всегда включён</Badge>
      </div>

      {/* Telegram — привязка в отдельной карточке выше; здесь мьют-toggle */}
      {settings.telegram.available && (
        <ChannelToggleRow
          title="Telegram"
          linked={settings.telegram.linked}
          enabled={settings.telegram.enabled}
          disabled={isPending}
          onToggle={(v) => toggle('telegram', v)}
          notLinkedHint="Привяжите Telegram в карточке выше, чтобы получать уведомления."
        />
      )}

      {/* Max — нативная привязка (deep-link) + toggle */}
      {settings.max.available && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <ChannelToggleRow
            title="Max"
            linked={settings.max.linked}
            enabled={settings.max.enabled}
            disabled={isPending}
            onToggle={(v) => toggle('max', v)}
            notLinkedHint="Привяжите аккаунт Max, чтобы получать уведомления."
          />
          {settings.max.linked ? (
            <Button
              variant="danger"
              size="sm"
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  await unlinkMaxAction();
                  toast.success('Max отвязан');
                  router.refresh();
                })
              }
            >
              Отвязать Max
            </Button>
          ) : maxDeepLink ? (
            <a
              href={maxDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-orange-600 underline break-all"
            >
              Открыть в Max
            </a>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await generateMaxLinkAction();
                  if (result.ok) setMaxDeepLink(result.deepLink);
                  else toast.error(errorMessageRu(result.error));
                })
              }
            >
              Привязать Max
            </Button>
          )}
        </div>
      )}

      {/* WhatsApp — номер (через агрегатор) + toggle */}
      {settings.whatsapp.available && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <ChannelToggleRow
            title="WhatsApp"
            linked={!!settings.whatsapp.phone}
            enabled={settings.whatsapp.enabled}
            disabled={isPending}
            onToggle={(v) => toggle('whatsapp', v)}
            notLinkedHint="Укажите номер телефона, чтобы получать уведомления в WhatsApp."
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field htmlFor="wa-phone" label="Номер телефона" error={phoneError}>
                <Input
                  id="wa-phone"
                  type="tel"
                  placeholder="+7 900 000-00-00"
                  value={phone}
                  invalid={!!phoneError}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError(null);
                  }}
                />
              </Field>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveWhatsappPhoneAction(phone);
                  if (result.ok) {
                    toast.success(result.phone ? 'Номер сохранён' : 'Номер удалён');
                    router.refresh();
                  } else {
                    setPhoneError(errorMessageRu(result.error));
                  }
                })
              }
            >
              Сохранить
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelToggleRow({
  title,
  linked,
  enabled,
  disabled,
  onToggle,
  notLinkedHint,
}: {
  title: string;
  linked: boolean;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  notLinkedHint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-700">{title}</p>
        {!linked && <p className="text-xs text-gray-400">{notLinkedHint}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || !linked}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 accent-[#F97316]"
        />
        {enabled ? 'Включён' : 'Выключен'}
      </label>
    </div>
  );
}
