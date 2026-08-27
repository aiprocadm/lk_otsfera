'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import {
  previewCatalogImportAction,
  commitCatalogImportAction,
  type CatalogPreviewResult,
} from '@/server-actions/admin/catalogImport';

/**
 * Импорт каталога из Excel (`У-137`, этап 5 PR-2).
 *
 * Двухшаговый диалог по эталону импорта сотрудников: сначала «что произойдёт»,
 * потом запись. Между шагами файл **не перечитывается** — на шаге 2 в сервис
 * уходят ровно те разобранные строки, что человек увидел в сводке (сервис
 * валидирует их повторно). Ошибки файла показываются в error-регионе `Dialog`
 * (§9: всегда смонтированный `role="alert"`).
 */
export function ImportCatalogDialog({
  cabinet,
  companyId,
}: {
  /** Кабинет для гарда раздела в action (`requireSettingsSection`). */
  cabinet: SettingsCabinet;
  /** Компания, в чей каталог пишем: админ выбрал явно, руководитель — своя. */
  companyId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Extract<CatalogPreviewResult, { ok: true }> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function close() {
    // Страховка на случай, если закрытие позовут в обход примитива: сам
    // `Dialog` уже не пускает Escape, крестик и клик по фону во время записи
    // (§9), поэтому через интерфейс эта ветка недостижима.
    /* v8 ignore next */
    if (busy) return;
    setOpen(false);
    setPreview(null);
    setErrors([]);
  }

  function backToFile() {
    setPreview(null);
    setErrors([]);
  }

  async function onPreview(fd: FormData) {
    setBusy(true);
    setErrors([]);
    try {
      // Размер проверяем ДО отправки: файл больше 25 МБ Next отбрасывает
      // на bodySizeLimit раньше входа в action (§11 CLAUDE.md) — серверная
      // проверка размера для такого файла недостижима, человек получил бы
      // сетевую ошибку вместо объяснения.
      const file = fd.get('file');
      if (file instanceof File && file.size > IMPORT_MAX_FILE_MB * 1024 * 1024) {
        setErrors([`Файл больше ${IMPORT_MAX_FILE_MB} МБ — разбейте на части.`]);
        return;
      }
      fd.set('companyId', companyId);
      const res = await previewCatalogImportAction(cabinet, fd);
      if (!res.ok) {
        setErrors(res.errors);
        setPreview(null);
        return;
      }
      setPreview(res);
      setErrors(res.errors);
    } catch {
      // Сбой сети/сервера — не молчим (§15).
      setErrors(['Не удалось проверить файл — сервер недоступен, попробуйте ещё раз.']);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    // Кнопка «Импортировать» существует только вместе с предпросмотром —
    // проверка нужна TypeScript'у, через интерфейс не достижима.
    /* v8 ignore next */
    if (!preview) return;
    setBusy(true);
    try {
      const res = await commitCatalogImportAction(cabinet, companyId, preview.rows);
      if (!res.ok) {
        setErrors([res.error]);
        return;
      }
      toast.success(`Каталог обновлён: создано ${res.created} · обновлено ${res.updated}`);
      close();
      router.refresh();
    } catch {
      setErrors(['Не удалось импортировать — сервер недоступен, попробуйте ещё раз.']);
    } finally {
      setBusy(false);
    }
  }

  // Ошибки едут в error-регион Dialog (красный блок с role="alert" — стили
  // даёт сам примитив, здесь только содержимое).
  const errorRegion =
    errors.length > 0 ? (
      <div data-testid="import-catalog-errors">
        <p className="font-medium">Что не так в файле:</p>
        <ul className="mt-1 text-xs space-y-0.5">
          {errors.slice(0, 20).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        {errors.length > 20 && <p className="text-xs mt-1">…и ещё {errors.length - 20}</p>}
      </div>
    ) : undefined;

  const willWrite = preview ? preview.willCreate + preview.willUpdate : 0;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-testid="import-catalog-open"
      >
        Импорт из Excel
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Импорт каталога из Excel"
        size="lg"
        busy={busy}
        error={errorRegion}
      >
        <div className="space-y-4">
          {!preview && (
            <>
              <p className="text-sm text-gray-600">
                Заполните шаблон и загрузите его — перед записью покажем, что изменится. Строки
                сопоставляются по артикулу: знакомый артикул обновит позицию, новый — создаст.
              </p>
              <form
                action={(fd) => {
                  void onPreview(fd);
                }}
                className="space-y-3"
                data-testid="import-catalog-form"
              >
                <input
                  type="file"
                  name="file"
                  accept=".xlsx"
                  required
                  className="block w-full text-sm"
                  data-testid="import-catalog-file"
                />
                <Button type="submit" disabled={busy}>
                  {busy ? 'Читаю файл…' : 'Проверить файл'}
                </Button>
              </form>
            </>
          )}

          {preview && (
            <div className="space-y-3" data-testid="import-catalog-preview">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <p className="font-medium text-[#111111]">Что произойдёт</p>
                <p className="text-gray-700 mt-1">
                  Будет создано: <strong>{preview.willCreate}</strong> · обновлено:{' '}
                  <strong>{preview.willUpdate}</strong> · строк с ошибками:{' '}
                  <strong>{preview.errors.length}</strong>
                </p>
                {preview.willUpdate > 0 && (
                  <p className="text-xs text-amber-800 mt-2" data-testid="import-catalog-overwrite">
                    Обновление перезаписывает все поля позиции значениями из файла: пустая
                    ячейка — это «значение по умолчанию», а не «оставить как было».
                  </p>
                )}
              </div>

              {willWrite === 0 && (
                <p className="text-sm text-gray-600" data-testid="import-catalog-nothing">
                  В файле нет ни одной строки, которую можно записать, — исправьте ошибки и
                  проверьте файл ещё раз.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void onCommit()}
                  disabled={busy || willWrite === 0}
                  data-testid="import-catalog-commit"
                >
                  {busy ? 'Записываю…' : 'Импортировать'}
                </Button>
                <Button type="button" variant="secondary" onClick={backToFile}>
                  Назад
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
