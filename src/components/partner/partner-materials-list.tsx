import React from 'react';
import { Badge, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import type { PartnerMaterialRow } from '@/lib/services/partnerMaterials/partner';
import {
  PARTNER_MATERIAL_CATEGORIES,
  PARTNER_MATERIAL_CATEGORY_LABELS,
} from '@/lib/services/partnerMaterials/categories';
import { buttonClass } from '@/lib/ui/buttonClass';
import { PartnerMaterialDownloadButton } from './partner-material-download-button';

/**
 * Раздел «Материалы» партнёра (`У-237`): карточки по категориям, поиск,
 * «Скачать» или «Открыть» (ссылка), дата и метка «Новое» 7 дней. Издатель
 * подписан на каждой карточке — у партнёра могут быть материалы разных компаний.
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

export function PartnerMaterialsList({ rows, q }: { rows: PartnerMaterialRow[]; q: string }) {
  const groups = PARTNER_MATERIAL_CATEGORIES.map((c) => ({
    category: c,
    items: rows.filter((r) => r.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5" data-testid="partner-materials">
      <form method="get" action="/partner/materials" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Поиск по названию и описанию…"
          aria-label="Поиск по материалам"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none md:w-80"
        />
        <button type="submit" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          Найти
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon="📦"
          message={
            q
              ? 'По этому запросу ничего не найдено — попробуйте другое слово.'
              : 'Материалов пока нет — их публикует учебный центр, с которым работают ваши организации. Как только появится прайс, презентация или инструкция, она будет здесь.'
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.category} className="space-y-2" data-testid={`materials-${g.category}`}>
            <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
              {PARTNER_MATERIAL_CATEGORY_LABELS[g.category]}
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4"
                  data-testid={`material-${m.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium text-[#111111]">{m.title}</div>
                    {m.isNew && <Badge tone="info">Новое</Badge>}
                  </div>
                  <div className="text-xs text-gray-500">{m.companyName}</div>
                  {m.description && <p className="text-sm text-gray-600">{m.description}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                    <span>
                      {m.file ? `${m.file.fileName} · ${formatSize(m.file.size)}` : 'Ссылка'}
                      {' · '}
                      {fmtDate(m.publishedAt)}
                    </span>
                    {m.file ? (
                      <PartnerMaterialDownloadButton materialId={m.id} />
                    ) : m.externalUrl ? (
                      <a
                        href={m.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass({ variant: 'primary', size: 'sm' })}
                      >
                        Открыть ↗
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
