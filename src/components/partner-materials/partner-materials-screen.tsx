'use client';

import React, { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, EmptyState, Select } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { fmtDateTime } from '@/lib/format';
import type { HubMaterialRow } from '@/lib/services/partnerMaterials/hub';
import { PARTNER_MATERIAL_CATEGORY_LABELS } from '@/lib/services/partnerMaterials/shared';
import {
  publishPartnerMaterialAction,
  unpublishPartnerMaterialAction,
  updatePartnerMaterialAction,
} from '@/server-actions/admin/partnerMaterials';
import { PartnerMaterialUploadForm } from './partner-material-upload-form';

/**
 * Раздел хаба «Материалы для партнёров» (`У-237`) — один экран на два
 * кабинета сотрудников (`Р-23`): данные и права даёт страница роли.
 * Отличие администратора одно — он выбирает компанию-издателя.
 *
 * §15: заголовок и крошки — «где я», подзаголовок — «что здесь делают»,
 * «Добавить материал» — «что дальше». Пустой список объясняет, зачем раздел.
 */
type Cabinet = 'admin' | 'leader';

type Status = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };

const ACTION_ERRORS: Record<string, string> = {
  not_ready: 'Файл ещё проверяется антивирусом — опубликовать можно после проверки.',
  infected: 'Файл не прошёл проверку антивирусом — замените файл.',
  forbidden: 'Нет прав менять материалы этой компании.',
  not_found: 'Материал не найден — обновите страницу.',
};

export function materialStatus(row: HubMaterialRow): Status {
  if (row.file?.scanStatus === 'infected') return { label: 'Файл заражён', tone: 'danger' };
  if (row.file && row.file.scanStatus !== 'clean') return { label: 'Проверяется', tone: 'warning' };
  if (!row.isActive) return { label: 'Снят с публикации', tone: 'neutral' };
  if (row.publishedAt) return { label: 'Опубликован', tone: 'success' };
  return { label: 'Черновик', tone: 'neutral' };
}

function canPublish(row: HubMaterialRow): boolean {
  if (row.isActive && row.publishedAt) return false;
  if (row.externalUrl) return true;
  return row.file?.scanStatus === 'clean';
}

export function PartnerMaterialsScreen({
  cabinet,
  companyId,
  companies,
  rows,
}: {
  cabinet: Cabinet;
  companyId: string | null;
  /** Список компаний — только у администратора; руководителю не нужен. */
  companies: { id: string; name: string }[];
  rows: HubMaterialRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openDownloads, setOpenDownloads] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const crumbs = buildCabinetBreadcrumbs(cabinet, `/${cabinet}/settings`, [
    { label: 'Материалы для партнёров' },
  ]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function run(
    id: string,
    action: (
      c: Cabinet,
      fd: FormData
    ) => Promise<{ ok: boolean; error?: string; messages?: string[] }>,
    fd: FormData,
    okMessage: string
  ) {
    setBusyId(id);
    const res = await action(cabinet, fd);
    setBusyId(null);
    if (!res.ok) {
      const msg =
        res.messages?.join(' ') ??
        ACTION_ERRORS[res.error ?? ''] ??
        errorMessageRu(res.error ?? 'internal', 'Не удалось выполнить действие.');
      toast.error(msg);
      return false;
    }
    toast.success(okMessage);
    refresh();
    return true;
  }

  async function replaceFile(id: string, file: File) {
    const fd = new FormData();
    fd.set('file', file);
    setBusyId(id);
    try {
      const res = await fetch(`/api/partner-materials/${id}/file`, { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          messages?: string[];
        };
        toast.error(
          body.messages?.join(' ') ??
            ACTION_ERRORS[body.error ?? ''] ??
            errorMessageRu(body.error ?? `http_${res.status}`, 'Не удалось заменить файл.')
        );
        return;
      }
      toast.success('Файл заменён и отправлен на проверку.');
      refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Материалы для партнёров"
        subtitle="Прайсы, презентации, шаблоны и инструкции, которые партнёры видят в своём кабинете."
        breadcrumbs={crumbs}
        action={
          companyId ? (
            <Button size="sm" onClick={() => setAdding((v) => !v)} data-testid="add-material">
              Добавить материал
            </Button>
          ) : null
        }
      />

      {companies.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Компания-издатель
          <Select
            value={companyId ?? ''}
            onChange={(e) =>
              router.push(
                `/${cabinet}/settings/processes/partner-materials?company=${e.target.value}`
              )
            }
            data-testid="company-select"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      )}

      {!companyId && (
        <EmptyState
          icon="🏢"
          message="У вашей учётной записи нет компании — материалы публикуются от имени компании."
        />
      )}

      {adding && companyId && (
        <PartnerMaterialUploadForm
          companyId={companyId}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {companyId && rows.length === 0 && !adding && (
        <EmptyState
          icon="📦"
          message="Материалов пока нет — добавьте первый: прайс, презентацию или инструкцию, и партнёры увидят его в разделе «Материалы»."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              Добавить материал
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <ul className="space-y-3" data-testid="hub-materials">
          {rows.map((row) => {
            const status = materialStatus(row);
            const busy = busyId === row.id;
            return (
              <li
                key={row.id}
                className="rounded-xl border border-gray-200 bg-white p-4 space-y-2"
                data-testid={`hub-material-${row.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[#111111]">{row.title}</span>
                      <Badge tone="info">{PARTNER_MATERIAL_CATEGORY_LABELS[row.category]}</Badge>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    {row.description && (
                      <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                        {row.description}
                      </p>
                    )}
                    <div className="mt-1 text-xs text-gray-500">
                      {row.file ? `Файл: ${row.file.fileName}` : `Ссылка: ${row.externalUrl}`}
                      {row.file?.scanStatus === 'infected' && row.file.scanReason
                        ? ` — ${row.file.scanReason}`
                        : ''}
                      {' · '}обновлён {fmtDateTime(row.updatedAt)} ({row.updatedByName})
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <button
                      type="button"
                      className="underline decoration-dotted"
                      onClick={() => setOpenDownloads(openDownloads === row.id ? null : row.id)}
                      data-testid={`downloads-toggle-${row.id}`}
                    >
                      Скачиваний: {row.downloadsCount}
                    </button>
                  </div>
                </div>

                {openDownloads === row.id && (
                  <div
                    className="rounded-lg bg-[#F3F4F6] p-3 text-xs text-gray-700"
                    data-testid="downloads-list"
                  >
                    {row.downloads.length === 0 ? (
                      'Пока никто не скачивал.'
                    ) : (
                      <ul className="space-y-1">
                        {row.downloads.map((d, i) => (
                          <li key={i}>
                            {d.userName} — {fmtDateTime(d.at)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {editingId === row.id ? (
                  <form
                    className="grid gap-2 sm:grid-cols-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      fd.set('id', row.id);
                      const ok = await run(
                        row.id,
                        updatePartnerMaterialAction,
                        fd,
                        'Материал обновлён.'
                      );
                      if (ok) setEditingId(null);
                    }}
                    data-testid={`edit-form-${row.id}`}
                  >
                    <input
                      name="title"
                      defaultValue={row.title}
                      required
                      maxLength={200}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      aria-label="Название"
                    />
                    <select
                      name="category"
                      defaultValue={row.category}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      aria-label="Категория"
                    >
                      {Object.entries(PARTNER_MATERIAL_CATEGORY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <textarea
                      name="description"
                      defaultValue={row.description ?? ''}
                      rows={2}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm sm:col-span-2"
                      aria-label="Описание"
                    />
                    {row.externalUrl !== null && (
                      <input
                        name="externalUrl"
                        type="url"
                        defaultValue={row.externalUrl}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm sm:col-span-2"
                        aria-label="Ссылка"
                      />
                    )}
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={row.sortOrder}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      aria-label="Порядок"
                    />
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" size="sm" loading={busy}>
                        Сохранить
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canPublish(row) && (
                      <Button
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('id', row.id);
                          void run(
                            row.id,
                            publishPartnerMaterialAction,
                            fd,
                            'Материал опубликован — партнёры его видят.'
                          );
                        }}
                      >
                        {row.publishedAt ? 'Вернуть в публикацию' : 'Опубликовать'}
                      </Button>
                    )}
                    {row.isActive && row.publishedAt && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('id', row.id);
                          void run(
                            row.id,
                            unpublishPartnerMaterialAction,
                            fd,
                            'Материал снят с публикации.'
                          );
                        }}
                      >
                        Снять с публикации
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditingId(row.id)}
                      disabled={busy}
                    >
                      Редактировать
                    </Button>
                    {row.externalUrl === null && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => fileInputs.current[row.id]?.click()}
                        >
                          Заменить файл
                        </Button>
                        <input
                          type="file"
                          className="hidden"
                          data-testid={`replace-file-${row.id}`}
                          ref={(el) => {
                            fileInputs.current[row.id] = el;
                          }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void replaceFile(row.id, f);
                            e.target.value = '';
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
