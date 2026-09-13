/**
 * Презентационные компоненты пакета миграции из Битрикс24 (этап 2 PR-3,
 * `У-193`, `У-198`): сводка предпросмотра, список пакетов, строки «нужно
 * решение»/«пропустим» и адреса раздела.
 *
 * Все четыре — серверные и без состояния, поэтому харнесс Pattern P:
 * `renderToString` в node-окружении, `next/link` подменён простой ссылкой.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { BatchSummary } from '@/components/bitrix/batch-summary';
import { BatchList, BATCH_STATUS_LABELS, formatDate } from '@/components/bitrix/batch-list';
import { BatchRows } from '@/components/bitrix/batch-rows';
import { BITRIX_BATCHES, BITRIX_ROOT, batchHref } from '@/components/bitrix/hrefs';
import type { PipelineCounts } from '@/lib/services/bitrix/pipeline';
import {
  BITRIX_ENTITIES,
  emptyCounts,
  type BitrixEntity,
  type PlanRow,
} from '@/lib/services/bitrix/mapping/types';
import type { BitrixBatchView } from '@/lib/services/bitrix/preview';

/** Сводка: все сущности по нулям, кроме перечисленных. */
function counts(over: Partial<Record<BitrixEntity, Partial<PipelineCounts[BitrixEntity]>>> = {}) {
  const base = Object.fromEntries(
    BITRIX_ENTITIES.map((e) => [e, { ...emptyCounts(), ...(over[e] ?? {}) }])
  ) as Record<BitrixEntity, PipelineCounts[BitrixEntity]>;
  return { ...base, progress: null, total: 0, warnings: [] } satisfies PipelineCounts;
}

function batch(over: Partial<BitrixBatchView> = {}): BitrixBatchView {
  return {
    id: 'b1',
    status: 'preview',
    source: 'rest',
    mode: 'initial',
    createdAt: new Date('2026-09-13T09:05:00Z'),
    startedAt: null,
    appliedAt: null,
    importedByName: 'Анна Админова',
    settings: {
      from: null,
      to: null,
      openOnly: false,
      withFiles: true,
      defaultManagerId: null,
      fileKeys: [],
      tables: {},
    },
    counts: null,
    errors: [],
    ready: false,
    ...over,
  };
}

function row(over: Partial<PlanRow> = {}): PlanRow {
  return {
    entity: 'deal',
    bitrixId: '7',
    title: 'Поставка щитов',
    action: 'conflict',
    reason: 'стадия не сопоставлена',
    ...over,
  };
}

/** Текст без разметки — так проще проверять подписи и числа рядом. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

describe('hrefs', () => {
  it('адреса раздела собраны из корня, карточка пакета — корень + история + id', () => {
    expect(BITRIX_ROOT).toBe('/admin/settings/integrations/bitrix');
    expect(BITRIX_BATCHES).toBe('/admin/settings/integrations/bitrix/history');
    expect(batchHref('b-42')).toBe('/admin/settings/integrations/bitrix/history/b-42');
  });
});

describe('formatDate', () => {
  it('показывает московское время, а не UTC браузера', () => {
    // 09:05 UTC — это 12:05 в Москве: сотрудник читает свои часы, а не серверные.
    expect(formatDate(new Date('2026-09-13T09:05:00Z'))).toBe('13.09.2026, 12:05');
    // Полночь по Москве приходится на предыдущие сутки UTC — дата тоже московская.
    expect(formatDate(new Date('2026-01-01T21:30:00Z'))).toBe('02.01.2026, 00:30');
  });
});

describe('BatchSummary', () => {
  it('четыре числа на сущность; сущности без записей не показываются', () => {
    const html = renderToString(
      React.createElement(BatchSummary, {
        counts: counts({
          organization: { create: 3, update: 2, skip: 1, conflict: 0 },
          deal: { create: 10, update: 0, skip: 4, conflict: 0 },
        }),
      })
    );

    const plain = text(html);
    expect(plain).toContain('Организации');
    expect(plain).toContain('Сделки');
    // Пустые сущности на экран не лезут: список короткий и читаемый.
    expect(plain).not.toContain('Заказы из выигранных сделок');
    expect(plain).not.toContain('Заметки');

    expect(html).toContain('data-testid="count-organization-create"');
    expect(plain).toContain('Создадим 3');
    expect(plain).toContain('Обновим 2');
    expect(plain).toContain('Пропустим 1');
    expect(html).toContain('data-testid="count-deal-create"');
  });

  it('«Нужно решение» появляется только там, где счётчик не ноль', () => {
    const html = renderToString(
      React.createElement(BatchSummary, {
        counts: counts({
          contact: { create: 1, update: 0, skip: 0, conflict: 0 },
          lead: { create: 0, update: 0, skip: 0, conflict: 5 },
        }),
      })
    );

    expect(html).toContain('data-testid="count-lead-conflict"');
    expect(text(html)).toContain('Нужно решение 5');
    // У контактов конфликтов нет — строки «Нужно решение» у них тоже нет.
    expect(html).not.toContain('data-testid="count-contact-conflict"');
    expect(text(html).match(/Нужно решение/g)).toHaveLength(1);
  });

  it('пустая сводка объясняет, что переносить нечего, и не рисует карточек', () => {
    const html = renderToString(React.createElement(BatchSummary, { counts: counts() }));
    expect(text(html)).toContain('В выбранном периоде переносить нечего');
    expect(html).not.toContain('data-testid="count-');
  });
});

describe('BatchList', () => {
  it('дата со ссылкой в карточку, кто запустил, источник, состояние и число записей', () => {
    const html = renderToString(
      React.createElement(BatchList, {
        batches: [
          batch({
            id: 'b-1',
            status: 'preview',
            source: 'rest',
            counts: { ...counts(), total: 128 },
          }),
          batch({
            id: 'b-2',
            status: 'applied',
            source: 'file',
            importedByName: 'Борис Петров',
            createdAt: new Date('2026-09-10T06:00:00Z'),
            counts: { ...counts(), total: 0 },
          }),
        ],
      })
    );

    expect(html).toContain('Пакеты миграции из Битрикс24'); // подпись таблицы для читалки
    const plain = text(html);
    expect(plain).toContain('13.09.2026, 12:05');
    expect(plain).toContain('Анна Админова');
    expect(plain).toContain('Портал по вебхуку');
    expect(plain).toContain('Предпросмотр готов');
    expect(plain).toContain('128');

    expect(html).toContain('href="/admin/settings/integrations/bitrix/history/b-1"');
    expect(html).toContain('href="/admin/settings/integrations/bitrix/history/b-2"');
    expect(plain).toContain('10.09.2026, 09:00');
    expect(plain).toContain('Борис Петров');
    expect(plain).toContain('Загруженные выгрузки');
    expect(plain).toContain('Применён');
    // counts есть, но записей ноль — показываем честный ноль, а не прочерк.
    expect(plain).toContain('0');
  });

  it('пакет без сводки показывает прочерк; незнакомые источник и состояние — как есть', () => {
    const html = renderToString(
      React.createElement(BatchList, {
        batches: [
          batch({
            counts: null,
            source: 'lagacy-export',
            status: 'unknown_status' as BitrixBatchView['status'],
          }),
        ],
      })
    );
    const plain = text(html);
    expect(plain).toContain('—');
    // Код вместо немой пустоты: видно, что пришло из базы (§3 CLAUDE.md).
    expect(plain).toContain('lagacy-export');
    expect(plain).toContain('unknown_status');
  });

  it('все восемь состояний пакета имеют русскую подпись', () => {
    expect(Object.keys(BATCH_STATUS_LABELS)).toEqual([
      'preview_pending',
      'preview',
      'applying',
      'applied',
      'rolling_back',
      'rolled_back',
      'rollback_partial',
      'failed',
    ]);
    expect(BATCH_STATUS_LABELS['failed']).toBe('Не удалось');
  });

  it('пустой список — просто пустая таблица с шапкой', () => {
    const html = renderToString(React.createElement(BatchList, { batches: [] }));
    expect(text(html)).toContain('Пакет Источник Состояние Записей');
    expect(html).not.toContain('href="/admin/settings/integrations/bitrix/history/');
  });
});

describe('BatchRows', () => {
  it('конфликты и пропуски — разными таблицами, с количеством и причиной', () => {
    const html = renderToString(
      React.createElement(BatchRows, {
        rows: [
          row({ entity: 'deal', bitrixId: '7', title: 'Поставка щитов', action: 'conflict' }),
          row({
            entity: 'organization',
            bitrixId: '11',
            title: 'ООО «Ромашка»',
            action: 'conflict',
            reason: 'ИНН у организации другой компании',
          }),
          row({
            entity: 'file',
            bitrixId: '99',
            title: '',
            action: 'skip',
            reason: 'источник не даёт файлов',
          }),
          // create/update в таблицы не попадают — это не «о чём решать».
          row({ entity: 'contact', bitrixId: '3', title: 'Иванов', action: 'create' }),
        ],
      })
    );

    expect(html).toContain('data-testid="bitrix-conflicts"');
    expect(html).toContain('data-testid="bitrix-skips"');
    const plain = text(html);
    expect(plain).toContain('Нужно решение ( 2 )');
    expect(plain).toContain('Эти записи не перенесутся, пока причина не устранена.');
    expect(plain).toContain('Пропустим ( 1 )');
    expect(plain).toContain('Так и задумано');
    expect(plain).toContain('Поставка щитов');
    expect(plain).toContain('ИНН у организации другой компании');
    // Безымянная запись показывается своим идентификатором в портале.
    expect(plain).toContain('99');
    expect(plain).not.toContain('Иванов');
  });

  it('только конфликты — таблицы пропусков нет, и наоборот', () => {
    const onlyConflicts = renderToString(
      React.createElement(BatchRows, { rows: [row({ action: 'conflict' })] })
    );
    expect(onlyConflicts).toContain('data-testid="bitrix-conflicts"');
    expect(onlyConflicts).not.toContain('data-testid="bitrix-skips"');

    const onlySkips = renderToString(
      React.createElement(BatchRows, { rows: [row({ action: 'skip', reason: 'пустая запись' })] })
    );
    expect(onlySkips).not.toContain('data-testid="bitrix-conflicts"');
    expect(onlySkips).toContain('data-testid="bitrix-skips"');
  });

  it('ни конфликтов, ни пропусков — объяснение вместо пустых таблиц', () => {
    const html = renderToString(
      React.createElement(BatchRows, { rows: [row({ action: 'create' })] })
    );
    expect(text(html)).toContain('Ни конфликтов, ни пропусков');
    expect(html).not.toContain('data-testid="bitrix-conflicts"');
    expect(html).not.toContain('data-testid="bitrix-skips"');
  });
});
