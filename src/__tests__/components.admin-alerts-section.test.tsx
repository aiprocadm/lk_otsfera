import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { AlertsSection } from '@/components/admin/alerts-section';
import type { AlertStateRow } from '@/lib/services/admin/alerts';

function makeAlert(overrides: Partial<AlertStateRow> = {}): AlertStateRow {
  return {
    key: 'dlq_depth',
    status: 'firing',
    severity: 'critical',
    message: 'DLQ переполнен: 12 задач',
    value: 12,
    firstSeenAt: new Date('2026-07-16T10:00:00Z'),
    lastNotifiedAt: new Date('2026-07-16T10:05:00Z'),
    resolvedAt: null,
    updatedAt: new Date('2026-07-16T10:05:00Z'),
    ...overrides,
  };
}

describe('AlertsSection', () => {
  it('пустое состояние: «Алертов нет — система в порядке»', () => {
    const html = renderToString(React.createElement(AlertsSection, { alerts: [] }));
    expect(html).toContain('Алертов нет — система в порядке');
  });

  it('подпись про воркер monitoring.evaluateAlerts (каждые 5 минут) рендерится всегда', () => {
    const html = renderToString(React.createElement(AlertsSection, { alerts: [] }));
    expect(html).toContain('monitoring.evaluateAlerts');
    expect(html).toContain('5 минут');
  });

  it('firing critical: danger-тона у severity и статуса, ключ, сообщение, значение и даты', () => {
    const html = renderToString(React.createElement(AlertsSection, { alerts: [makeAlert()] }));
    expect(html).toContain('dlq_depth');
    expect(html).toContain('critical');
    expect(html).toContain('firing');
    expect(html).toContain('DLQ переполнен: 12 задач');
    expect(html).toContain('>12<');
    // danger-тон Badge (severity critical + статус firing)
    expect(html).toContain('bg-red-50');
    expect(html).toContain('text-red-700');
    // даты в московском времени: 10:00 UTC → 13:00 МСК
    expect(html).toContain('16.07.2026');
    expect(html).toContain('13:00');
    expect(html).toContain('13:05');
  });

  it('warning severity → warning-тон бейджа', () => {
    const html = renderToString(
      React.createElement(AlertsSection, { alerts: [makeAlert({ severity: 'warning' })] })
    );
    expect(html).toContain('bg-amber-50');
    expect(html).toContain('text-amber-700');
  });

  it('resolved: нейтральный статус, resolvedAt рендерится датой', () => {
    const html = renderToString(
      React.createElement(AlertsSection, {
        alerts: [
          makeAlert({
            status: 'resolved',
            severity: 'warning',
            resolvedAt: new Date('2026-07-16T11:00:00Z'),
          }),
        ],
      })
    );
    expect(html).toContain('resolved');
    expect(html).toContain('bg-gray-100');
    expect(html).toContain('14:00'); // 11:00 UTC → 14:00 МСК
    expect(html).not.toContain('bg-red-50');
  });

  it('value=null и resolvedAt=null → «—»', () => {
    const html = renderToString(
      React.createElement(AlertsSection, { alerts: [makeAlert({ value: null, resolvedAt: null })] })
    );
    expect(html).toContain('—');
  });
});
