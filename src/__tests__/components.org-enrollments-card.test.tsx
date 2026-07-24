import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgEnrollmentsCard } from '@/components/organization/org-enrollments-card';
import type { OrgEnrollmentSummary } from '@/lib/services/organization/dashboard';

function summary(overrides: Partial<OrgEnrollmentSummary> = {}): OrgEnrollmentSummary {
  return {
    id: 'e1',
    directionName: 'Охрана труда',
    studentCount: 1,
    status: 'pending',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides
  };
}

function renderCard(rows: OrgEnrollmentSummary[]): string {
  return renderToString(React.createElement(OrgEnrollmentsCard, { rows })).replace(/<!-- -->/g, '');
}

describe('OrgEnrollmentsCard', () => {
  it('пустое состояние: подсказка и кнопка «Подать заявку на обучение»', () => {
    const html = renderCard([]);
    expect(html).toContain('Заявки на обучение');
    expect(html).toContain('Заявок пока нет — подайте первую');
    expect(html).toContain('Подать заявку на обучение');
    expect(html).toContain('href="/organization/enrollments"');
    expect(html).not.toContain('<ul');
  });

  it('строка заявки: направление, счётчик, бейдж, дата и ссылка на деталку', () => {
    const html = renderCard([summary()]);
    expect(html).toContain('Охрана труда');
    expect(html).toContain('1 слушатель');
    expect(html).toContain('На рассмотрении');
    expect(html).toContain('href="/organization/enrollments/e1"');
    expect(html).not.toContain('Заявок пока нет');
  });

  it('склонение счётчика: 2 слушателя / 5 слушателей; ссылки по id каждой строки', () => {
    const html = renderCard([
      summary({ id: 'e2', studentCount: 2, status: 'in_training' }),
      summary({ id: 'e5', directionName: 'Пожарная безопасность', studentCount: 5, status: 'certificates_ready' })
    ]);
    expect(html).toContain('2 слушателя');
    expect(html).toContain('5 слушателей');
    expect(html).toContain('href="/organization/enrollments/e2"');
    expect(html).toContain('href="/organization/enrollments/e5"');
    expect(html).toContain('Пожарная безопасность');
    // Бейджи статусов
    expect(html).toContain('Идёт обучение');
    expect(html).toContain('Удостоверения готовы');
  });

  it('кнопка подачи присутствует и при непустом списке', () => {
    const html = renderCard([summary()]);
    expect(html).toContain('Подать заявку на обучение');
    expect(html).toContain('href="/organization/enrollments"');
  });
});
