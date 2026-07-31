import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ClientRequestList } from '@/components/client-requests/client-request-list';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';

function row(overrides: Partial<ClientRequestRow> = {}): ClientRequestRow {
  return {
    id: 'cr1',
    source: 'partner_cabinet',
    companyName: 'ООО Ромашка',
    inn: null,
    contactName: 'Иван Петров',
    contactPhone: null,
    contactEmail: null,
    subject: 'Обучение по охране труда',
    body: null,
    status: 'submitted',
    submittedByName: 'Партнёр 1',
    partnerName: null,
    organizationName: null,
    organizationId: null,
    rejectedReason: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    triagedAt: null,
    attachmentCount: 0,
    ...overrides,
  };
}

/** renderToString вставляет <!-- --> между текстовыми узлами — срезаем для проверки текста. */
function html(rows: ClientRequestRow[], detailHrefBase?: string): string {
  return renderToString(React.createElement(ClientRequestList, { rows, detailHrefBase })).replace(
    /<!-- -->/g,
    ''
  );
}

describe('ClientRequestList', () => {
  it('пустое состояние: подсказка про форму выше', () => {
    expect(html([])).toContain('Обращений пока нет — отправьте первое через форму выше');
  });

  it('строка: тема, компания, бейдж статуса и дата', () => {
    const out = html([row()]);
    expect(out).toContain('Обучение по охране труда');
    expect(out).toContain('ООО Ромашка');
    expect(out).toContain('Подана');
    expect(out).toContain('15.01.2024');
  });

  it('rejected: показывает и бейдж «Отклонена», и причину отказа', () => {
    const out = html([row({ status: 'rejected', rejectedReason: 'Неполные данные' })]);
    expect(out).toContain('Отклонена');
    expect(out).toContain('Неполные данные');
  });

  it('причина отказа НЕ показывается для не-rejected статусов, даже если поле заполнено', () => {
    const out = html([row({ status: 'converted', rejectedReason: 'stale leftover reason' })]);
    expect(out).not.toContain('stale leftover reason');
  });

  it('с detailHrefBase: тема — ссылка на деталку + отдельная ссылка «подробнее»', () => {
    const out = html([row()], '/partner/requests');
    expect(out).toContain('href="/partner/requests/cr1"');
    expect(out).toContain('подробнее');
  });

  it('без detailHrefBase: ссылок нет, тема — обычный текст', () => {
    const out = html([row()]);
    expect(out).not.toContain('href=');
    expect(out).not.toContain('подробнее');
    expect(out).toContain('Обучение по охране труда');
  });

  it('несколько строк рендерятся все', () => {
    const out = html([
      row(),
      row({
        id: 'cr2',
        subject: 'Второе обращение',
        companyName: 'АО Вектор',
        status: 'in_triage',
      }),
    ]);
    expect(out).toContain('Обучение по охране труда');
    expect(out).toContain('Второе обращение');
    expect(out).toContain('АО Вектор');
    expect(out).toContain('В работе');
  });
});
