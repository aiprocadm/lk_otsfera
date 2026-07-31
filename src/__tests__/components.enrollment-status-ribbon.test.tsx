import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EnrollmentStatusRibbon } from '@/components/enrollment/enrollment-status-ribbon';
import { ENROLLMENT_PIPELINE } from '@/lib/services/enrollments/lifecycle';
import { ENROLLMENT_STATUS_LABEL } from '@/lib/services/enrollments/labels';

/** Разрезает html на элементы <li> статусной ленты (5 точек конвейера). */
function liItems(html: string): string[] {
  return html.split('<li').slice(1);
}

describe('EnrollmentStatusRibbon — конвейер из 5 точек', () => {
  it.each(ENROLLMENT_PIPELINE.map((s, i) => [s, i] as const))(
    'статус %s: достигнуто точек %#+1, aria-current на текущей',
    (status, idx) => {
      const html = renderToString(React.createElement(EnrollmentStatusRibbon, { status }));
      // Лента — упорядоченный список с aria-label и всеми 5 подписями
      expect(html).toContain('aria-label="Статус заявки"');
      const items = liItems(html);
      expect(items).toHaveLength(5);
      for (const step of ENROLLMENT_PIPELINE) {
        expect(html).toContain(ENROLLMENT_STATUS_LABEL[step]);
      }
      // aria-current="step" ровно один раз — на элементе текущего статуса
      const currentItems = items.filter((li) => li.includes('aria-current="step"'));
      expect(currentItems).toHaveLength(1);
      expect(items.indexOf(currentItems[0]!)).toBe(idx);
      expect(currentItems[0]).toContain(ENROLLMENT_STATUS_LABEL[status]);
      // Достигнутые точки закрашены оранжевым (idx+1 штук), остальные — белые
      const reachedDots = items.filter((li) => li.includes('bg-[#F97316] border-[#F97316]'));
      expect(reachedDots).toHaveLength(idx + 1);
      const pendingDots = items.filter((li) => li.includes('bg-white border-gray-300'));
      expect(pendingDots).toHaveLength(5 - (idx + 1));
      // Подписи достигнутых этапов выделены, недостигнутых — серые
      const reachedLabels = items.filter((li) => li.includes('text-[#111111] font-medium'));
      expect(reachedLabels).toHaveLength(idx + 1);
    }
  );

  it('первая точка без соединительной линии, у остальных линия есть (4 линии)', () => {
    const html = renderToString(React.createElement(EnrollmentStatusRibbon, { status: 'pending' }));
    const items = liItems(html);
    const connectors = items.filter((li) => li.includes('h-0.5 w-6'));
    expect(connectors).toHaveLength(4);
    expect(items[0]).not.toContain('h-0.5 w-6');
  });

  it('линии до текущей точки оранжевые, после — серые', () => {
    const html = renderToString(
      React.createElement(EnrollmentStatusRibbon, { status: 'provisioned' })
    );
    const items = liItems(html);
    // provisioned = индекс 2 → линии перед li[1] и li[2] достигнуты, перед li[3] и li[4] — нет
    expect(items[1]).toContain('bg-[#F97316]');
    expect(items[2]).toContain('bg-[#F97316]');
    expect(items[3]).toContain('bg-gray-200');
    expect(items[4]).toContain('bg-gray-200');
  });
});

describe('EnrollmentStatusRibbon — rejected', () => {
  it('с причиной: плашка «Заявка отклонена: причина», ленты нет', () => {
    const html = renderToString(
      React.createElement(EnrollmentStatusRibbon, {
        status: 'rejected',
        rejectedReason: 'Неполные данные',
      })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Заявка отклонена: Неполные данные');
    expect(html).not.toContain('aria-label="Статус заявки"');
    expect(html).not.toContain('<ol');
  });

  it('без причины: только «Заявка отклонена», без двоеточия', () => {
    const html = renderToString(
      React.createElement(EnrollmentStatusRibbon, { status: 'rejected' })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Заявка отклонена');
    expect(html).not.toContain('Заявка отклонена:');
  });

  it('rejectedReason=null эквивалентен отсутствию причины', () => {
    const html = renderToString(
      React.createElement(EnrollmentStatusRibbon, { status: 'rejected', rejectedReason: null })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Заявка отклонена');
    expect(html).not.toContain('Заявка отклонена:');
  });
});
