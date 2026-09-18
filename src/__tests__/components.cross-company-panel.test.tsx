import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className, ...rest }, children),
}));

import { CrossCompanyPanel } from '@/components/admin/cross-company-panel';
import type { CrossCompanyResult } from '@/lib/services/admin/crossCompany';

/**
 * Свод по компаниям на «Главной» администратора (`У-246`).
 *
 * Проверяется читаемость: видно ли, у какой компании что, и ведут ли плитки
 * туда, где это разбирают.
 */
const base: CrossCompanyResult = {
  year: 2026,
  month: 9,
  rows: [
    { companyId: 'c1', companyName: 'Первая', orders: 4, paid: '750.00', leads: 3, requests: 1 },
    { companyId: 'c2', companyName: 'Вторая', orders: 0, paid: '0.00', leads: 0, requests: 0 },
  ],
  docsNotPushed: 0,
  lastMigration: null,
};

describe('CrossCompanyPanel (У-246)', () => {
  it('показывает строку на каждую компанию и ведёт в её аналитику', () => {
    const html = renderToString(<CrossCompanyPanel data={base} />);
    expect(html).toContain('Первая');
    expect(html).toContain('Вторая');
    expect(html).toContain('/admin/finance?company=c1');
    expect(html).toContain('09.2026');
  });

  it('невыгруженных документов нет — так и сказано', () => {
    const html = renderToString(<CrossCompanyPanel data={base} />);
    expect(html).toContain('Всё уехало');
  });

  it('невыгруженные документы ведут в разбор', () => {
    const html = renderToString(<CrossCompanyPanel data={{ ...base, docsNotPushed: 12 }} />);
    expect(html).toContain('12');
    expect(html).toContain('/admin/documents?oneCPushStatus=failed');
    expect(html).toContain('Нажмите, чтобы разобрать список');
  });

  it('переносов не было — объяснение и ссылка в раздел', () => {
    const html = renderToString(<CrossCompanyPanel data={base} />);
    expect(html).toContain('Переносов ещё не было');
    expect(html).toContain('/admin/settings/integrations/bitrix');
  });

  it('последний перенос показан по-русски: компания, состояние, режим, время', () => {
    const html = renderToString(
      <CrossCompanyPanel
        data={{
          ...base,
          lastMigration: {
            companyName: 'Вторая',
            status: 'applied',
            mode: 'initial',
            createdAt: new Date('2026-09-10T10:00:00Z'),
          },
        }}
      />
    );
    expect(html).toContain('Применён');
    expect(html).toContain('первый перенос');
    // Машинных слов на экране быть не должно.
    expect(html).not.toContain('applied');
    expect(html).not.toContain('initial');
  });

  it('незнакомое состояние пакета показывается как есть, а не прячется', () => {
    const html = renderToString(
      <CrossCompanyPanel
        data={{
          ...base,
          lastMigration: {
            companyName: 'Вторая',
            status: 'новое_состояние',
            mode: 'новый_режим',
            createdAt: new Date('2026-09-10T10:00:00Z'),
          },
        }}
      />
    );
    expect(html).toContain('новое_состояние');
    expect(html).toContain('новый_режим');
  });

  it('компаний нет — объяснение без кнопки в никуда', () => {
    const html = renderToString(<CrossCompanyPanel data={{ ...base, rows: [] }} />);
    expect(html).toContain('Компаний на платформе нет');
    // Экрана создания компании в кабинете не существует — кнопки быть не должно.
    expect(html).not.toContain('/admin/companies');
  });
});
