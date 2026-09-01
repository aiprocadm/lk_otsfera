import React from 'react';
import { EmptyState, Field, Select } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import {
  DOCUMENT_TEMPLATE_GROUPS,
  DOCUMENT_TEMPLATE_SLOTS,
  type DocumentTemplateSlot,
} from '@/lib/documents/documentTemplate';
import type { TemplateRow } from '@/lib/services/documents/templates';
import { DocumentTemplateField } from './document-templates-editor';

/**
 * «Шаблоны документов» — экран общий для администратора и руководителя
 * (`У-160`, решение `Р-23`).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (`components-no-db`). Поля рисуются ПО РЕЕСТРУ слотов, а не перечисляются
 * здесь: следующий тип документа добавит строки в реестр и не тронет экран.
 */
export function DocumentTemplatesScreen({
  cabinet,
  hasCompany,
  companies,
  activeCompanyId,
  rows,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании править нечего — экран объясняет это. */
  hasCompany: boolean;
  companies: Array<{ id: string; name: string }>;
  activeCompanyId: string | null;
  rows: TemplateRow[];
}) {
  const isAdmin = cabinet === 'admin';
  const base = `/${cabinet}/settings/catalogs/document-templates`;
  const bySlot = new Map(rows.map((r) => [r.slot, r]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Шаблоны документов"
        subtitle="Свои формулировки для договора, доп. соглашения и коммерческого предложения. Пока текст не правили — печатается стандартный."
      />

      {isAdmin && (
        <form method="get" action={base} className="max-w-md">
          <Field htmlFor="company" label="Компания-исполнитель">
            <Select id="company" name="company" defaultValue={activeCompanyId ?? ''}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <button type="submit" className="text-sm text-[#EA580C] underline mt-2">
            Показать
          </button>
        </form>
      )}

      {!hasCompany || !activeCompanyId ? (
        <EmptyState
          // Сообщение привязано к ПРИЧИНЕ, а не к роли: «компаний нет» и
          // «компания не выбрана» — разные беды, и подменять одно другим
          // значит врать человеку про состояние системы.
          message={
            !hasCompany && isAdmin
              ? 'Нет ни одной компании-исполнителя — заводить тексты документов не для кого.'
              : !hasCompany
                ? 'Ваша учётная запись не привязана к компании, поэтому тексты документов править нельзя. Обратитесь к администратору.'
                : 'Выберите компанию-исполнителя, чтобы посмотреть и поправить её тексты.'
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Текст договора — юридический документ, поэтому рядом с каждым
              полем сказано, где он печатается: править «Ответственность»
              вслепую опаснее, чем не править вовсе (§15). */}
          {DOCUMENT_TEMPLATE_GROUPS.map((group) => {
            const slots = DOCUMENT_TEMPLATE_SLOTS.filter((s) => s.group === group.id);
            return (
              <section key={group.id} className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#111111]">{group.title}</h2>
                  <p className="text-xs text-gray-500">{group.hint}</p>
                </div>
                {slots.map((slot: DocumentTemplateSlot) => {
                  const row = bySlot.get(slot.key);
                  // Реестр и выборка расходятся только при опечатке в ключе;
                  // молча пропускаем, чтобы экран не падал целиком.
                  /* v8 ignore next */
                  if (!row) return null;
                  return (
                    <DocumentTemplateField
                      key={slot.key}
                      cabinet={cabinet}
                      companyId={activeCompanyId}
                      slot={slot}
                      row={row}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
