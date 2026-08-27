import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

/**
 * Этап 5 (`У-136`) — серверный экран «Каталог услуг и цены».
 *
 * Экран презентационный, поэтому рендерим renderToString с данными в пропсах.
 * Вложенные клиентские диалоги рендерятся по-настоящему (их триггеры — часть
 * ответа «что делать дальше»), но их зависимости от next/navigation и
 * server-actions мокируются: боевые actions тянут prisma-клиент.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server-actions/admin/catalogItems', () => ({
  createCatalogItemAction: vi.fn(),
  updateCatalogItemAction: vi.fn(),
  setCatalogItemActiveAction: vi.fn(),
}));

import { PriceListScreen } from '@/components/settings/price-list-screen';
import type { CatalogItemRow } from '@/lib/services/admin/catalogItems';

function makeRow(overrides: Partial<CatalogItemRow> = {}): CatalogItemRow {
  return {
    id: 'ci-1',
    name: 'Обучение по охране труда',
    code: 'OT-101',
    unit: 'person',
    price: '12500.00',
    vatRate: '0.2000',
    vatIncluded: true,
    directionId: 'dir-1',
    directionName: 'Охрана труда',
    description: null,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

type Props = Parameters<typeof PriceListScreen>[0];

const BASE: Props = {
  cabinet: 'admin',
  hasCompany: true,
  companies: [
    { id: 'co-1', name: 'ООО «ЦО»' },
    { id: 'co-2', name: 'ООО «Юг»' },
  ],
  activeCompanyId: 'co-1',
  items: [],
  directions: [{ id: 'dir-1', name: 'Охрана труда' }],
  q: '',
  includeInactive: false,
};

function html(overrides: Partial<Props> = {}): string {
  return renderToString(React.createElement(PriceListScreen, { ...BASE, ...overrides }));
}

// Ожидаемый формат цены строим тем же API, что и компонент: тест не должен
// зависеть от того, каким разделителем тысяч живёт ICU конкретного Node.
const PRICE_12500 = `${(12500).toLocaleString('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})} ₽`;

describe('PriceListScreen — admin с данными', () => {
  const out = html({
    items: [
      makeRow(),
      makeRow({
        id: 'ci-2',
        code: 'OT-102',
        unit: 'hour',
        price: '990.50',
        vatRate: null,
        vatIncluded: false,
        directionId: null,
        directionName: null,
        description: 'Выезд инструктора',
        isActive: false,
      }),
    ],
  });

  it('шапка: заголовок = пункту меню, подзаголовок объясняет назначение', () => {
    expect(out).toContain('Каталог услуг и цены');
    expect(out).toContain('из них собираются строки заказов и документов');
  });

  it('селектор компании с кнопкой «Показать» и обеими компаниями', () => {
    expect(out).toContain('Показать');
    expect(out).toContain('ООО «ЦО»');
    expect(out).toContain('ООО «Юг»');
    // Скрытое поле company в форме поиска — иначе «Найти» сбросит компанию.
    expect(out).toContain('type="hidden" name="company" value="co-1"');
  });

  it('панель поиска: поле q, чекбокс неактивных, кнопка «Найти»', () => {
    expect(out).toContain('name="q"');
    expect(out).toContain('показывать неактивные');
    expect(out).toContain('Найти');
  });

  it('строка каталога: единица словами, цена в ₽, НДС «в т.ч.», направление', () => {
    expect(out).toContain('Обучение по охране труда');
    expect(out).toContain('OT-101');
    expect(out).toContain('чел.');
    expect(out).toContain(PRICE_12500);
    expect(out).toContain('20% в т.ч.');
    expect(out).toContain('Охрана труда');
  });

  it('неактивная строка: приглушена, «не обл.», прочерк направления, описание', () => {
    expect(out).toContain('opacity-60');
    expect(out).toContain('не обл.');
    expect(out).toContain('—');
    expect(out).toContain('Выезд инструктора');
    expect(out).toContain('час');
    // Бейджи активности обеих строк.
    expect(out).toContain('>Да<');
    expect(out).toContain('>Нет<');
  });

  it('главная кнопка «Добавить услугу» и действия строки на месте', () => {
    expect(out).toContain('Добавить услугу');
    expect(out).toContain('Изменить');
    expect(out).toContain('Деактивировать');
  });

  it('сноска про 500 не показывается, пока строк меньше', () => {
    expect(out).not.toContain('первые 500');
  });
});

describe('PriceListScreen — ветки НДС и фильтров', () => {
  it('НДС сверх цены: «5% сверх»', () => {
    const out = html({ items: [makeRow({ vatRate: '0.0500', vatIncluded: false })] });
    expect(out).toContain('5% сверх');
  });

  it('includeInactive=true — чекбокс отмечен, q попадает в поле', () => {
    const out = html({ includeInactive: true, q: 'огнетуш', items: [makeRow()] });
    expect(out).toContain('checked');
    expect(out).toContain('value="огнетуш"');
  });
});

describe('PriceListScreen — руководитель', () => {
  it('со своей компанией: без селектора компаний и скрытого поля company', () => {
    const out = html({ cabinet: 'leader', companies: [], items: [makeRow()] });
    expect(out).not.toContain('Показать');
    expect(out).not.toContain('type="hidden" name="company"');
    expect(out).toContain('Найти');
    expect(out).toContain('OT-101');
  });

  it('без компании: role=alert с объяснением, форм и таблицы нет', () => {
    const out = html({
      cabinet: 'leader',
      hasCompany: false,
      companies: [],
      activeCompanyId: null,
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain('не указана компания');
    expect(out).not.toContain('Найти');
    expect(out).not.toContain('Добавить услугу');
  });
});

describe('PriceListScreen — пустые состояния', () => {
  it('каталог пуст: EmptyState с объяснением и кнопкой «Добавить услугу»', () => {
    const out = html();
    expect(out).toContain('Здесь пока пусто');
    expect(out).toContain('Каталог этой компании пока пуст');
    expect(out).toContain('Добавить услугу');
  });

  it('пусто из-за поиска: объяснение про запрос, кнопка остаётся', () => {
    const out = html({ q: 'нет такого' });
    expect(out).toContain('По этому запросу ничего не найдено');
    expect(out).toContain('Добавить услугу');
  });

  it('админ без единой компании: объяснение вместо каталога', () => {
    const out = html({ companies: [], activeCompanyId: null });
    expect(out).toContain('В системе ещё нет ни одной компании');
    expect(out).not.toContain('Найти');
  });
});

describe('PriceListScreen — молчаливое усечение', () => {
  it('ровно 500 строк — сноска «показаны первые 500»', () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      makeRow({ id: `ci-${i}`, code: `C-${i}` })
    );
    const out = html({ items });
    expect(out).toContain('Показаны первые 500 позиций — уточните поиск');
  });
});
