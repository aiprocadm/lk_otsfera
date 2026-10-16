'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Textarea } from '@/components/ui';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { errorMessageRu } from '@/lib/errors/messages';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/lib/ui/toast';
import { setTaskResultAction } from '@/server-actions/tasks';
import type { TaskResultFileRow } from '@/lib/services/tasks/result';

/**
 * «Результат» задачи (этап 5 ТЗ 13.10.2026, `У-299`, `Р-5-3`): что
 * получилось — текст и файлы.
 *
 * Текст сохраняется серверным действием, файл — роутом
 * (`/api/tasks/[id]/result-files`): у server actions предел тела 25 МБ, и
 * большой файл молча пропал бы. Скачивание — по временной ссылке через
 * `/api/tasks/result-files/[id]`; пока антивирус не проверил файл, это видно.
 */
function sizeRu(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function TaskResultPanel({
  taskId,
  result,
  resultUpdatedAt,
  files,
}: {
  taskId: string;
  result: string | null;
  resultUpdatedAt: Date | string | null;
  files: TaskResultFileRow[];
}) {
  const router = useRouter();
  const [text, setText] = useState(result ?? '');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveText() {
    const fd = new FormData();
    fd.set('id', taskId);
    fd.set('result', text);
    setBusy(true);
    const res = await setTaskResultAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить результат.'));
      return;
    }
    toast.success('Результат сохранён.');
    router.refresh();
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.set('file', file);
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/result-files`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errorMessageRu(data.error ?? 'storage', 'Не удалось приложить файл.'));
        return;
      }
      toast.success('Файл приложен. Его проверит антивирус.');
      router.refresh();
    } catch {
      toast.error('Нет связи с сервером — попробуйте ещё раз.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(fileId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/result-files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errorMessageRu(data.error ?? 'storage', 'Не удалось удалить файл.'));
        return;
      }
      toast.success('Файл удалён.');
      router.refresh();
    } catch {
      toast.error('Нет связи с сервером — попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  const inputId = `task-${taskId}-result`;
  return (
    <section
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
      data-testid="task-result"
    >
      <h2 className="text-sm font-semibold text-[#111111]">Результат</h2>
      <Field
        htmlFor={inputId}
        label="Что получилось"
        hint={
          resultUpdatedAt
            ? `Обновлено ${fmtDateTime(resultUpdatedAt)}`
            : 'Опишите, что сделано: так коллеги поймут итог, не открывая переписку.'
        }
      >
        <Textarea
          id={inputId}
          rows={3}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={text === (result ?? '')}
        onClick={saveText}
      >
        Сохранить результат
      </Button>

      <div className="space-y-2">
        {files.length === 0 ? (
          <p className="text-xs text-gray-500">
            Файлы не приложены — добавьте отчёт, акт или фотографию.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <a
                  href={`/api/tasks/result-files/${f.id}`}
                  className="text-[#EA580C] hover:underline"
                >
                  {f.name}
                </a>
                <span className="text-xs text-gray-500">{sizeRu(f.size)}</span>
                {f.scanStatus === 'pending' && (
                  <span className="text-xs text-amber-700">проверяется антивирусом</span>
                )}
                {f.canDelete && (
                  <button
                    type="button"
                    className="ml-auto text-xs text-gray-500 hover:text-red-600"
                    disabled={busy}
                    onClick={() => remove(f.id)}
                  >
                    Удалить
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#EA580C] hover:underline">
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          Приложить файл
        </label>
        <p className="text-xs text-gray-500">
          PDF, документы, таблицы и изображения, не больше {DEFAULT_MAX_FILE_SIZE_MB} МБ.
        </p>
      </div>
    </section>
  );
}
