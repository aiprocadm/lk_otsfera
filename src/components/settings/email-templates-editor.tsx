'use client';

import React, { useState, useTransition } from 'react';
import {
  previewTemplateAction,
  resetTemplateAction,
  saveTemplateAction,
  sendTestTemplateAction,
} from '@/server-actions/admin/emailTemplates';
import { toast } from '@/lib/ui/toast';
import { EMAIL_TEMPLATE_REGISTRY } from '@/lib/email/templateRegistry';
import type { TemplateRow } from '@/lib/email/templateOverrides';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Редактор текстов писем (`У-128`).
 *
 * **Пустые поля означают «как раньше».** Стандартный текст сюда не
 * копируется: копия заморозила бы письмо — вёрстка и формулировки менялись бы
 * в коде, а у компании оставался бы старый текст.
 *
 * Список допустимых подстановок стоит **рядом** с полями, а не в справке:
 * иначе человек угадывает имена и получает отказ сохранить.
 */
export function EmailTemplatesEditor({
  cabinet,
  rows,
}: {
  cabinet: SettingsCabinet;
  rows: TemplateRow[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Пока поля пустые, письмо собирает программа — так же, как раньше. Оформление письма (шапка,
        кнопка, подвал) остаётся прежним в любом случае: вы меняете только тему и текст.
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <TemplateCard
            key={row.key}
            cabinet={cabinet}
            row={row}
            open={openKey === row.key}
            onToggle={() => setOpenKey(openKey === row.key ? null : row.key)}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  cabinet,
  row,
  open,
  onToggle,
}: {
  cabinet: SettingsCabinet;
  row: TemplateRow;
  open: boolean;
  onToggle: () => void;
}) {
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const placeholders = EMAIL_TEMPLATE_REGISTRY[row.key].placeholders;
  const custom = row.source !== 'default';

  function unknownText(unknown: string[] | undefined): string {
    const list = (unknown ?? []).map((t) => `{{${t}}}`).join(', ');
    return `Неизвестные подстановки: ${list}. Возьмите из списка справа.`;
  }

  function doPreview() {
    startTransition(async () => {
      const res = await previewTemplateAction(cabinet, row.key, subject, body);
      if (res.ok) {
        setPreview({ subject: res.subject, body: res.body });
        return;
      }
      setPreview(null);
      toast.error(
        res.error === 'unknown_placeholder' ? unknownText(res.unknown) : 'Не удалось показать.'
      );
    });
  }

  function doSave() {
    startTransition(async () => {
      const res = await saveTemplateAction(cabinet, row.key, subject, body);
      if (res.ok) {
        toast.success('Текст письма сохранён.');
        return;
      }
      if (res.error === 'unknown_placeholder') {
        toast.error(unknownText(res.unknown));
        return;
      }
      toast.error(
        res.error === 'company_required'
          ? 'У вашей учётной записи не указана компания — обратитесь к администратору.'
          : 'Заполните и тему, и текст — либо очистите оба поля, чтобы вернуть стандартное письмо.'
      );
    });
  }

  function doReset() {
    if (!window.confirm('Вернуть стандартный текст? Ваш текст будет удалён.')) return;
    startTransition(async () => {
      const res = await resetTemplateAction(cabinet, row.key);
      if (res.ok) {
        setSubject('');
        setBody('');
        setPreview(null);
        toast.success('Возвращён стандартный текст.');
        return;
      }
      toast.error('У вашей учётной записи не указана компания — обратитесь к администратору.');
    });
  }

  function doTest() {
    startTransition(async () => {
      const res = await sendTestTemplateAction(cabinet, row.key, subject, body);
      if (res.ok) {
        toast.success(
          res.skipped
            ? 'Письмо не отправлено: отправка почты выключена или не задан адрес.'
            : 'Пробное письмо отправлено вам на почту.'
        );
        return;
      }
      toast.error('Не удалось отправить пробное письмо.');
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-sm text-[#111111]">
          {row.label}
          {custom && (
            <span className="ml-2 text-xs text-amber-700">
              {row.source === 'company' ? 'свой текст' : 'текст платформы'}
            </span>
          )}
        </span>
        <span aria-hidden className="text-gray-400 text-xs">
          {open ? 'свернуть' : 'изменить'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <label className="block text-sm text-gray-700">
              <span className="block text-xs text-gray-500 mb-1">Тема письма</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={pending}
                placeholder="Пусто — стандартная тема"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </label>
            <label className="block text-sm text-gray-700">
              <span className="block text-xs text-gray-500 mb-1">Текст письма</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={pending}
                rows={7}
                placeholder="Пусто — стандартный текст"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={doSave}
                disabled={pending}
                className="px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={doPreview}
                disabled={pending}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg disabled:opacity-50"
              >
                Показать, как получится
              </button>
              <button
                type="button"
                onClick={doTest}
                disabled={pending}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg disabled:opacity-50"
              >
                Отправить себе
              </button>
              {custom && (
                <button
                  type="button"
                  onClick={doReset}
                  disabled={pending}
                  className="px-4 py-2 text-sm text-gray-600 underline disabled:opacity-50"
                >
                  вернуть стандартный
                </button>
              )}
            </div>

            {preview && (
              <div
                role="status"
                className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-1"
              >
                <div className="text-xs text-gray-500">Так письмо увидит получатель:</div>
                <div className="text-sm font-medium text-[#111111]">{preview.subject}</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{preview.body}</div>
              </div>
            )}
          </div>

          <div className="text-xs">
            <div className="text-gray-500 mb-1">Что можно подставить:</div>
            <ul className="space-y-1">
              {placeholders.map((p) => (
                <li key={p.token}>
                  <code className="font-mono text-[#111111] bg-gray-100 px-1 rounded">
                    {`{{${p.token}}}`}
                  </code>
                  <span className="text-gray-500"> — {p.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
