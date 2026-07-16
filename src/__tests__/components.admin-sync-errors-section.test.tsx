import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { SyncErrorsSection } from '@/components/admin/sync-errors-section';
import type { SyncErrorRow } from '@/lib/services/syncSummary';

function makeError(overrides: Partial<SyncErrorRow> = {}): SyncErrorRow {
  return {
    id: 'sl1',
    entity: 'payment',
    externalId: 'EXT-42',
    direction: 'inbound',
    operation: 'upsert',
    errorMessage: 'timeout calling 1C',
    durationMs: 1250,
    createdAt: new Date('2026-07-16T09:00:00Z'),
    ...overrides
  };
}

describe('SyncErrorsSection', () => {
  it('пустое состояние: «Ошибок нет»', () => {
    const html = renderToString(React.createElement(SyncErrorsSection, { errors: [] }));
    expect(html).toContain('Ошибок нет');
  });

  it('подпись про payload в БД (ПДн намеренно не выводится) рендерится всегда', () => {
    const html = renderToString(React.createElement(SyncErrorsSection, { errors: [] }));
    expect(html).toContain('payload');
    expect(html).toContain('ПДн');
  });

  it('строка: время (МСК), сущность, направление, операция, внешний ID, ошибка, длительность', () => {
    const html = renderToString(React.createElement(SyncErrorsSection, { errors: [makeError()] }));
    expect(html).toContain('16.07.2026'); // 09:00 UTC → 12:00 МСК
    expect(html).toContain('12:00');
    expect(html).toContain('payment');
    expect(html).toContain('inbound');
    expect(html).toContain('upsert');
    expect(html).toContain('EXT-42');
    expect(html).toContain('timeout calling 1C');
    expect(html).toContain('1250 мс');
  });

  it('длинная ошибка не рвёт раскладку: line-clamp/break-обёртка присутствует', () => {
    const html = renderToString(
      React.createElement(SyncErrorsSection, { errors: [makeError({ errorMessage: 'x'.repeat(500) })] })
    );
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('break-all');
  });

  it('externalId=null, errorMessage=null, durationMs=null → «—»', () => {
    const html = renderToString(
      React.createElement(SyncErrorsSection, {
        errors: [makeError({ externalId: null, errorMessage: null, durationMs: null })]
      })
    );
    expect(html).not.toContain('EXT-42');
    expect(html).not.toContain('мс');
    expect((html.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
