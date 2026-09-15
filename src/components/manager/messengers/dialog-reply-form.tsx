'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Select, Textarea } from '@/components/ui';
import { useFormAction } from '@/lib/ui/useFormAction';
import type { ReplyTemplateRow } from '@/lib/services/replyTemplates/crud';
import {
  addDialogNoteAction,
  applyReplyTemplateAction,
  sendDialogMessageAction,
} from '@/server-actions/messengers';

/**
 * Ответ из диалога (спека 2026-09-12 §5.2) и внутренняя заметка (`У-209`).
 *
 * Два режима в одной форме, потому что пишут в одно и то же поле, но с разным
 * исходом: ответ уходит клиенту, заметка остаётся внутри. Режим виден всегда —
 * подпись кнопки и рамка меняются вместе с ним, чтобы нельзя было «случайно»
 * отправить обсуждение клиенту.
 *
 * Шаблон (`У-208`) только вставляет текст в поле: отправляет всё равно
 * человек, и текст можно поправить до отправки.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет доступа к этому диалогу.',
  not_found: 'Диалог не найден.',
};

type Mode = 'reply' | 'note';

export function DialogReplyForm({
  dialogId,
  templates = [],
}: {
  dialogId: string;
  /** Шаблоны, подходящие каналу этого диалога; пусто — кнопки «Шаблон» нет. */
  templates?: ReplyTemplateRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>('reply');
  const [templateHint, setTemplateHint] = useState<string | null>(null);
  /** Что было в поле до вставки шаблона — чтобы вставку можно было отменить. */
  const [beforeTemplate, setBeforeTemplate] = useState<string | null>(null);

  /** Смена режима сбрасывает подсказку: она была про ответ, а не про заметку. */
  function switchMode(next: Mode) {
    setMode(next);
    setTemplateHint(null);
    setBeforeTemplate(null);
  }

  const reply = useFormAction<{ messageId: string }>({
    action: (formData) =>
      sendDialogMessageAction({ dialogId, text: String(formData.get('text') ?? '') }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Сообщение отправлено');
      formRef.current?.reset();
      setTemplateHint(null);
      setBeforeTemplate(null);
    },
  });

  const note = useFormAction<{ messageId: string }>({
    action: (formData) =>
      addDialogNoteAction({ dialogId, text: String(formData.get('text') ?? '') }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Заметка сохранена — клиент её не увидит');
      formRef.current?.reset();
      setTemplateHint(null);
      setBeforeTemplate(null);
    },
  });

  const active = mode === 'reply' ? reply : note;

  async function insertTemplate(templateId: string) {
    if (!templateId) return;
    const result = await applyReplyTemplateAction({ dialogId, templateId });
    if (!result.ok) {
      // Коды различаются: «нет доступа» и «шаблон удалили» — разные новости,
      // и общий текст отправил бы человека искать не ту причину.
      toast.error(
        result.error === 'forbidden'
          ? 'Нет доступа к этому диалогу'
          : result.error === 'validation'
            ? 'Не удалось вставить шаблон'
            : 'Шаблон не найден — возможно, его удалили'
      );
      return;
    }
    // Запоминаем набранное: вставка затирает поле, и без отмены человек
    // потерял бы свой текст безвозвратно.
    setBeforeTemplate(textRef.current?.value ?? '');
    if (textRef.current) textRef.current.value = result.text;
    // Пустые подстановки показываем ДО отправки: иначе клиент получит письмо
    // с пропущенным именем или номером заказа.
    setTemplateHint(
      result.empty.length > 0
        ? `Не удалось подставить: ${result.empty.join(', ')} — допишите вручную.`
        : null
    );
  }

  return (
    <form
      ref={formRef}
      action={active.formAction}
      className={`flex flex-col gap-2 rounded-xl p-3 ${
        mode === 'note' ? 'border border-amber-200 bg-amber-50' : 'border border-transparent'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={mode === 'reply' ? 'primary' : 'secondary'}
          onClick={() => switchMode('reply')}
        >
          Ответ клиенту
        </Button>
        <Button
          type="button"
          variant={mode === 'note' ? 'primary' : 'secondary'}
          onClick={() => switchMode('note')}
        >
          Заметка для своих
        </Button>
        {mode === 'reply' && templates.length > 0 && (
          <Select
            aria-label="Шаблон ответа"
            defaultValue=""
            onChange={(e) => void insertTemplate(e.target.value)}
            disabled={active.pending}
          >
            <option value="">Шаблон…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Textarea
        ref={textRef}
        name="text"
        rows={3}
        required
        disabled={active.pending}
        placeholder={mode === 'note' ? 'Заметка видна только коллегам…' : 'Напишите клиенту…'}
        aria-label={mode === 'note' ? 'Текст заметки' : 'Текст сообщения'}
      />

      {mode === 'note' && (
        <p className="text-xs text-amber-800">
          Заметку клиент не увидит: она не уходит в канал и не попадает в его кабинет. Упомяните
          коллегу через @имя — ему придёт уведомление.
        </p>
      )}
      {templateHint && <p className="text-xs text-amber-800">{templateHint}</p>}
      {beforeTemplate !== null && beforeTemplate !== '' && (
        <p className="text-xs text-gray-500">
          Шаблон заменил ваш текст.{' '}
          <button
            type="button"
            className="underline hover:text-gray-700"
            onClick={() => {
              if (textRef.current) textRef.current.value = beforeTemplate;
              setBeforeTemplate(null);
              setTemplateHint(null);
            }}
          >
            Вернуть как было
          </button>
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button type="submit" loading={active.pending} disabled={active.pending}>
          {mode === 'note' ? 'Сохранить заметку' : 'Отправить'}
        </Button>
        {active.errorText && (
          <p role="alert" className="text-xs text-red-600">
            {active.errorText}
          </p>
        )}
      </div>
    </form>
  );
}
