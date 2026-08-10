'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import {
  previewStudentsAction,
  commitStudentsImportAction,
  type PreviewResult,
} from '@/server-actions/students-import';

/**
 * Импорт сотрудников списком (`У-27`, `У-28`, этап 5 PR-2).
 *
 * Два шага, как у импорта 1С: сначала «что произойдёт», потом запись. Между
 * шагами файл **не перечитывается** — подтверждается ровно то, что человек
 * увидел на экране.
 */
export function ImportStudentsDialog({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function close() {
    if (busy) return;
    setOpen(false);
    setPreview(null);
    setErrors([]);
  }

  async function onPreview(fd: FormData) {
    setBusy(true);
    setErrors([]);
    try {
      fd.set('organizationId', organizationId);
      const res = await previewStudentsAction(fd);
      if (!res.ok) {
        setErrors(res.errors);
        setPreview(null);
        return;
      }
      setPreview(res);
      setErrors(res.errors);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await commitStudentsImportAction(organizationId, preview.rows);
      if (!res.ok) {
        setErrors([res.error]);
        return;
      }
      toast.success(
        `Добавлено сотрудников: ${res.created}` +
          (res.skipped > 0 ? `, пропущено дубликатов: ${res.skipped}` : '')
      );
      close();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-testid="import-students-open"
      >
        Загрузить списком
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Загрузка сотрудников списком"
        size="lg"
        busy={busy}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Заполните шаблон и загрузите его. Обязательна только колонка «ФИО» — почту и СНИЛС можно
            добавить позже.
          </p>
          <a
            href="/api/students/import-template"
            className="inline-block text-sm text-[#EA580C] hover:underline"
            data-testid="import-students-template"
          >
            Скачать шаблон Excel
          </a>

          {!preview && (
            <form
              action={(fd) => {
                void onPreview(fd);
              }}
              className="space-y-3"
              data-testid="import-students-form"
            >
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="block w-full text-sm"
                data-testid="import-students-file"
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Читаю файл…' : 'Проверить файл'}
              </Button>
            </form>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
              <p className="text-sm font-medium text-red-800">Что не так в файле:</p>
              <ul className="mt-1 text-xs text-red-800 space-y-0.5">
                {errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {errors.length > 20 && (
                <p className="text-xs text-red-700 mt-1">…и ещё {errors.length - 20}</p>
              )}
            </div>
          )}

          {preview && (
            <div className="space-y-3" data-testid="import-students-preview">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <p className="font-medium text-[#111111]">Что произойдёт</p>
                <p className="text-gray-700 mt-1">
                  Будет создано: <strong>{preview.willCreate}</strong> · пропущено дубликатов:{' '}
                  <strong>{preview.duplicates.length}</strong>
                  {preview.errors.length > 0 && (
                    <>
                      {' '}
                      · строк с ошибками: <strong>{preview.errors.length}</strong>
                    </>
                  )}
                </p>
              </div>

              {preview.duplicates.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">
                    Эти строки пропустим — такие сотрудники уже есть:
                  </p>
                  <ul className="mt-1 text-xs text-amber-900 space-y-0.5">
                    {preview.duplicates.slice(0, 20).map((d) => (
                      <li key={d.line}>
                        Строка {d.line}: {d.name} → уже есть «{d.existingName}»
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void onCommit()}
                  disabled={busy || preview.willCreate === 0}
                  data-testid="import-students-commit"
                >
                  {busy ? 'Записываю…' : `Добавить ${preview.willCreate}`}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
                  Выбрать другой файл
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
