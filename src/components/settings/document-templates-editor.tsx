'use client';

import React, { useState } from 'react';
import { Button, Field, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  resetDocumentTemplateAction,
  saveDocumentTemplateAction,
} from '@/server-actions/documents/documentTemplates';
import type { ContractTemplateSlot } from '@/lib/documents/contractTemplate';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { TemplateRow } from '@/lib/services/documents/templates';

/**
 * Редактор одного пункта договора (`У-160`).
 *
 * Поле показывает ровно то, что печатается сейчас: свой текст компании либо
 * встроенную формулировку. Номер пункта в поле не пишется — его проставляет
 * сам документ, поэтому «2.2.» в начале текста напечаталось бы дважды.
 */
export function DocumentTemplateField({
  cabinet,
  companyId,
  slot,
  row,
}: {
  /** Кабинет задаёт, какой набор прав проверит серверное действие. */
  cabinet: SettingsCabinet;
  companyId: string;
  slot: ContractTemplateSlot;
  row: TemplateRow;
}) {
  const [body, setBody] = useState(row.body);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  /**
   * Что сейчас напечатается в документе. Держим в состоянии ЦЕЛИКОМ, а не
   * только признак «свой текст»: пропсы приходят с сервера и после сохранения
   * не меняются, а человек должен сразу видеть новую редакцию и погасшую
   * кнопку «Сохранить».
   */
  const [saved, setSaved] = useState({
    body: row.body,
    isCustom: row.isCustom,
    revision: row.revision,
  });
  // Кнопка гаснет ровно тогда, когда печатается уже то, что в поле. Иначе
  // повторный клик записал бы тот же текст и сжёг ещё один номер редакции —
  // а человек так и не понял бы, сохранилось ли.
  const dirty = body !== saved.body;

  async function save() {
    setBusy('save');
    const fd = new FormData();
    fd.set('companyId', companyId);
    fd.set('slot', slot.key);
    fd.set('body', body);
    try {
      const res = await saveDocumentTemplateAction(cabinet, fd);
      if (!res.ok) {
        toast.error(errorMessageRu(res.error));
        return;
      }
      setSaved({ body, isCustom: true, revision: res.revision });
      toast.success(`Пункт ${slot.clause} сохранён (редакция ${res.revision}).`);
    } catch {
      // Обрыв связи или перезапуск сервера: без этой ветки кнопка навсегда
      // осталась бы «Сохраняю…», и человек не понял бы, сохранилось ли.
      toast.error(errorMessageRu('network'));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    // Своего текста после сброса не останется: прежняя формулировка есть
    // только в уже выпущенных PDF, и восстановить её будет неоткуда.
    if (
      !window.confirm('Вернуть стандартный текст? Ваш текст будет удалён без возможности отмены.')
    )
      return;
    setBusy('reset');
    const fd = new FormData();
    fd.set('companyId', companyId);
    fd.set('slot', slot.key);
    let res: Awaited<ReturnType<typeof resetDocumentTemplateAction>>;
    try {
      res = await resetDocumentTemplateAction(cabinet, fd);
    } catch {
      toast.error(errorMessageRu('network'));
      setBusy(null);
      return;
    }
    setBusy(null);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error));
      return;
    }
    // И поле, и «что печатается» возвращаются к встроенному тексту разом:
    // разъедься они, один лишний клик записал бы стандартный текст в базу как
    // «свой» — то есть заморозил бы ровно то, чего избегает вся схема
    // «в базе только отличия».
    setBody(slot.defaultText);
    setSaved({ body: slot.defaultText, isCustom: false, revision: null });
    toast.success(`Пункт ${slot.clause} снова печатается стандартным текстом.`);
  }

  const id = `slot-${slot.key.replace('.', '-')}`;
  return (
    <div
      className="rounded-lg border border-gray-200 p-4"
      data-testid={`template-slot-${slot.key}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-[#111111]">
          Пункт {slot.clause} · {slot.where}
        </p>
        <p className="text-xs text-gray-500">
          {saved.isCustom ? `Свой текст, редакция ${saved.revision ?? '—'}` : 'Стандартный текст'}
        </p>
      </div>
      <Field htmlFor={id} label="Текст пункта" hint="Номер пункта система проставит сама.">
        <Textarea id={id} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {slot.placeholders.length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Подстановки:{' '}
          {slot.placeholders.map((p) => `{{${p.token}}} — ${p.label.toLowerCase()}`).join(' · ')}
          {slot.required.length > 0 && (
            <>
              {' '}
              <span className="text-[#EA580C]">
                Обязательна: {slot.required.map((t) => `{{${t}}}`).join(', ')}
              </span>
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <Button size="sm" disabled={busy !== null || !dirty} onClick={() => void save()}>
          {busy === 'save' ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved.isCustom && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void reset()}
          >
            {busy === 'reset' ? 'Возвращаю…' : 'Вернуть стандартный'}
          </Button>
        )}
      </div>
    </div>
  );
}
