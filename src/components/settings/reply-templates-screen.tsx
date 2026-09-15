'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, EmptyState, Input, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { useFormAction } from '@/lib/ui/useFormAction';
import { buildSettingsBreadcrumbs } from '@/lib/navigation/settings';
import type { ReplyTemplateRow } from '@/lib/services/replyTemplates/crud';
import {
  deleteReplyTemplateAction,
  saveReplyTemplateAction,
} from '@/server-actions/replyTemplates';

/**
 * «Шаблоны ответов» (`У-208`) — заготовки для частых ответов клиенту.
 *
 * Экран отвечает на три вопроса (§15): заголовок и крошки говорят, где мы;
 * подзаголовок — что здесь делают; главная кнопка «Добавить шаблон» и пустое
 * состояние с объяснением — что делать дальше.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Раздел доступен только сотрудникам вашей компании.',
  not_found: 'Шаблон не найден — возможно, его уже удалили.',
  invalid: 'Заполните название и текст, выберите существующие каналы.',
  text_too_long: 'Слишком длинный текст: название до 120 символов, шаблон до 4000.',
  unknown_placeholder:
    'В тексте есть подстановка, которой не существует. Проверьте написание — иначе клиент увидит её как есть.',
};

/** Подстановки, которые можно вставить; список приходит с сервера. */
type TokenHint = { token: string; label: string };

function TemplateForm({
  template,
  tokens,
  onDone,
}: {
  template: ReplyTemplateRow | null;
  tokens: TokenHint[];
  onDone: () => void;
}) {
  const { formAction, pending, errorText } = useFormAction<{ id: string }>({
    action: (formData) =>
      saveReplyTemplateAction({
        id: template?.id ?? null,
        title: String(formData.get('title') ?? ''),
        body: String(formData.get('body') ?? ''),
        channels: [],
        isActive: formData.get('isActive') === 'on',
        sortOrder: Number(formData.get('sortOrder') ?? 0) || 0,
      }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success(template ? 'Шаблон сохранён' : 'Шаблон добавлен');
      onDone();
    },
  });

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <Input
        name="title"
        required
        maxLength={120}
        defaultValue={template?.title ?? ''}
        placeholder="Например: «Счёт отправлен»"
        aria-label="Название шаблона"
        disabled={pending}
      />
      <Textarea
        name="body"
        rows={5}
        required
        maxLength={4000}
        defaultValue={template?.body ?? ''}
        placeholder="Здравствуйте, {{contact.name}}! Счёт по заказу {{order.number}} отправлен."
        aria-label="Текст шаблона"
        disabled={pending}
      />
      <p className="text-xs text-gray-500">
        Можно подставить:{' '}
        {tokens.map((t) => (
          <span key={t.token} className="mr-2 whitespace-nowrap">
            <code className="rounded bg-gray-100 px-1">{`{{${t.token}}}`}</code> — {t.label}
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={template?.isActive ?? true}
            disabled={pending}
          />
          Предлагать в диалогах
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Порядок
          <Input
            name="sortOrder"
            type="number"
            className="w-20"
            defaultValue={String(template?.sortOrder ?? 0)}
            disabled={pending}
            aria-label="Порядок в списке"
          />
        </label>
        <Button type="submit" loading={pending} disabled={pending}>
          {template ? 'Сохранить' : 'Добавить'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
      </div>
      {errorText && (
        <p role="alert" className="text-sm text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}

function DeleteButton({ template }: { template: ReplyTemplateRow }) {
  const { formAction, pending, errorText } = useFormAction<object>({
    action: () => deleteReplyTemplateAction({ id: template.id }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('Шаблон удалён'),
  });
  return (
    <form action={formAction}>
      <Button type="submit" variant="secondary" disabled={pending}>
        Удалить
      </Button>
      {errorText && (
        <p role="alert" className="text-xs text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}

export function ReplyTemplatesScreen({
  cabinet,
  rows,
  tokens,
}: {
  cabinet: 'admin' | 'leader';
  rows: ReplyTemplateRow[];
  tokens: TokenHint[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const addButton = (
    <Button onClick={() => setAdding(true)} disabled={adding}>
      Добавить шаблон
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={buildSettingsBreadcrumbs(
          cabinet,
          `/${cabinet}/settings/catalogs/reply-templates`
        )}
        title="Шаблоны ответов"
        subtitle="Заготовки для частых ответов клиенту: менеджер вставляет шаблон в переписку и правит перед отправкой."
        action={addButton}
      />

      {adding && <TemplateForm template={null} tokens={tokens} onDone={() => setAdding(false)} />}

      {rows.length === 0 && !adding ? (
        <EmptyState
          icon="💬"
          title="Шаблонов пока нет"
          message="Добавьте первый — и он появится в переписке под кнопкой «Шаблон»."
          action={addButton}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((t) =>
            editing === t.id ? (
              <li key={t.id}>
                <TemplateForm template={t} tokens={tokens} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={t.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#111111]">{t.title}</span>
                  {!t.isActive && <Badge tone="neutral">Не предлагается</Badge>}
                  <span className="text-xs text-gray-400">использован {t.usageCount} раз</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-600">
                  {t.body}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(t.id)}>
                    Изменить
                  </Button>
                  <DeleteButton template={t} />
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
