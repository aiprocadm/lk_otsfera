import React from 'react';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
} from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { CATALOG_UNIT_LABELS, type CatalogItemRow } from '@/lib/services/admin/catalogItems';
import { CatalogItemActiveButton, CatalogItemDialog } from './catalog-item-dialog';
import { ImportCatalogDialog } from './import-catalog-dialog';

/**
 * «Каталог услуг и цены» — экран общий для администратора и руководителя
 * (`У-136`, решение `Р-23`).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли, скоуп —
 * сервис: админ выбирает компанию явно, руководитель пришпилен к своей.
 */
export function PriceListScreen({
  cabinet,
  hasCompany,
  companies,
  activeCompanyId,
  items,
  directions,
  q,
  includeInactive,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании каталога нет — экран объясняет это. */
  hasCompany: boolean;
  companies: Array<{ id: string; name: string }>;
  activeCompanyId: string | null;
  items: CatalogItemRow[];
  directions: Array<{ id: string; name: string }>;
  q: string;
  includeInactive: boolean;
}) {
  const isAdmin = cabinet === 'admin';
  // Формы фильтров — обычные GET на адрес раздела: состояние живёт в URL,
  // ссылку с поиском можно отправить коллеге.
  const base = `/${cabinet}/settings/catalogs/price-list`;

  // Сужение до string один раз: дальше диалогам нужен непустой companyId.
  const addDialog =
    activeCompanyId !== null ? (
      <CatalogItemDialog cabinet={cabinet} companyId={activeCompanyId} directions={directions} />
    ) : null;

  const showCatalog = (isAdmin || hasCompany) && activeCompanyId !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Каталог услуг и цены"
        subtitle="Услуги и товары вашей компании с ценами — из них собираются строки заказов и документов"
        action={showCatalog && items.length > 0 ? addDialog : undefined}
      />

      {!isAdmin && !hasCompany ? (
        <p role="alert" className="text-sm text-red-600">
          У вашей учётной записи не указана компания — вести каталог нельзя. Обратитесь к
          администратору.
        </p>
      ) : activeCompanyId === null ? (
        <EmptyState
          icon="🏷️"
          message="В системе ещё нет ни одной компании — сначала создайте компанию, потом наполняйте её каталог."
        />
      ) : (
        <>
          {isAdmin && (
            <form method="get" action={base} className="flex flex-wrap items-end gap-2">
              <div className="w-64">
                <Field htmlFor="pl-company" label="Компания">
                  <Select id="pl-company" name="company" defaultValue={activeCompanyId}>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" variant="secondary">
                Показать
              </Button>
            </form>
          )}

          <form method="get" action={base} className="flex flex-wrap items-center gap-3">
            {isAdmin && <input type="hidden" name="company" value={activeCompanyId} />}
            <Input
              name="q"
              defaultValue={q}
              placeholder="Название или артикул"
              aria-label="Поиск: название или артикул"
              className="w-64"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                name="inactive"
                value="1"
                defaultChecked={includeInactive}
                className="accent-[#F97316] h-4 w-4"
              />
              показывать неактивные
            </label>
            <Button type="submit" variant="secondary">
              Найти
            </Button>
          </form>

          {/* Обмен с Excel (`У-137`): шаблон → импорт с предпросмотром → выгрузка. */}
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/catalog/import-template"
              download
              className="text-sm text-[#EA580C] hover:underline"
              data-testid="price-list-template"
            >
              Шаблон Excel
            </a>
            <ImportCatalogDialog cabinet={cabinet} companyId={activeCompanyId} />
            <a
              href={`/api/catalog/export?company=${activeCompanyId}`}
              className="text-sm text-[#EA580C] hover:underline"
              data-testid="price-list-export"
            >
              Экспорт
            </a>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon="🏷️"
              message={
                q
                  ? 'По этому запросу ничего не найдено — измените текст поиска или добавьте услугу.'
                  : 'Каталог этой компании пока пуст — добавьте первую услугу или товар.'
              }
              action={addDialog}
            />
          ) : (
            <>
              <TableShell overflow="x-auto">
                <THead>
                  <Th>Название</Th>
                  <Th>Артикул</Th>
                  <Th>Ед.</Th>
                  <Th>Цена</Th>
                  <Th>НДС</Th>
                  <Th>Направление</Th>
                  <Th>Активен</Th>
                  <Th>Действия</Th>
                </THead>
                <tbody>
                  {items.map((row) => (
                    // Неактивные строки приглушены: видно, что позиция есть,
                    // но в новые заказы не попадает.
                    <Tr key={row.id} className={row.isActive ? undefined : 'opacity-60'}>
                      <Td className="font-medium text-[#111111]">
                        {row.name}
                        {row.description && (
                          <span className="block text-xs font-normal text-gray-500">
                            {row.description}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <code className="text-sm text-orange-600">{row.code}</code>
                      </Td>
                      <Td>{CATALOG_UNIT_LABELS[row.unit]}</Td>
                      <Td className="whitespace-nowrap">{formatPrice(row.price)}</Td>
                      <Td className="whitespace-nowrap">{vatLabel(row)}</Td>
                      <Td>{row.directionName ?? '—'}</Td>
                      <Td>
                        <Badge tone={row.isActive ? 'success' : 'neutral'}>
                          {row.isActive ? 'Да' : 'Нет'}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <CatalogItemDialog
                            cabinet={cabinet}
                            companyId={activeCompanyId}
                            directions={directions}
                            item={row}
                          />
                          <CatalogItemActiveButton cabinet={cabinet} item={row} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
              {items.length === 500 && (
                <p className="text-xs text-gray-500">
                  Показаны первые 500 позиций — уточните поиск, чтобы увидеть остальные.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** «12 500,00 ₽» — ru-RU, всегда две цифры после запятой. */
function formatPrice(price: string): string {
  return `${Number(price).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

/** НДС: null → «не обл.», иначе процент + «в т.ч.» (в цене) или «сверх». */
function vatLabel(row: CatalogItemRow): string {
  if (row.vatRate === null) return 'не обл.';
  const pct = Math.round(Number(row.vatRate) * 100);
  return `${pct}% ${row.vatIncluded ? 'в т.ч.' : 'сверх'}`;
}
