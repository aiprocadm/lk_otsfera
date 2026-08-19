import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// Дропзона внутри деталки зовёт useRouter — мокаем навигацию для SSR-рендера.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import type { ClientRequestAttachmentRowVM } from '@/components/client-requests/client-request-attachments-list';

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

function attachment(
  overrides: Partial<ClientRequestAttachmentRowVM> = {}
): ClientRequestAttachmentRowVM {
  return {
    id: 'a1',
    name: 'договор.pdf',
    size: 2048,
    mimeType: 'application/pdf',
    createdAt: '2024-01-16T09:00:00Z',
    createdByUserName: 'Партнёр 1',
    ...overrides,
  };
}

function html(
  request: ClientRequestRow,
  attachments: ClientRequestAttachmentRowVM[] = [],
  backHref = '/partner/requests',
  breadcrumbs?: Array<{ label: string; href: string | null }>
): string {
  return renderToString(
    React.createElement(ClientRequestDetailView, { request, attachments, backHref, breadcrumbs })
  ).replace(/<!-- -->/g, '');
}

describe('ClientRequestDetailView', () => {
  it('шапка: тема, бейдж статуса, податель и ссылка «← Все обращения» на backHref', () => {
    const out = html(row(), [], '/organization/requests');
    expect(out).toContain('Обучение по охране труда');
    expect(out).toContain('Подана');
    expect(out).toContain('Партнёр 1');
    expect(out).toContain('href="/organization/requests"');
    expect(out).toContain('← Все обращения');
  });

  it('поля клиента: компания и контактное лицо всегда, опциональные — только когда заполнены', () => {
    const bare = html(row());
    expect(bare).toContain('ООО Ромашка');
    expect(bare).toContain('Иван Петров');
    expect(bare).not.toContain('ИНН');
    expect(bare).not.toContain('Телефон');
    expect(bare).not.toContain('Организация');

    const full = html(
      row({
        inn: '7701234567',
        contactPhone: '+79990001122',
        contactEmail: 'ivan@example.com',
        organizationName: 'ООО Заказчик',
      })
    );
    expect(full).toContain('7701234567');
    expect(full).toContain('+79990001122');
    expect(full).toContain('ivan@example.com');
    expect(full).toContain('ООО Заказчик');
  });

  it('блок «Описание» есть только при непустом body', () => {
    expect(html(row())).not.toContain('Описание');
    const out = html(row({ body: 'Нужно обучить 10 сотрудников' }));
    expect(out).toContain('Описание');
    expect(out).toContain('Нужно обучить 10 сотрудников');
  });

  it('rejected: блок «Причина отклонения» с текстом причины', () => {
    const out = html(row({ status: 'rejected', rejectedReason: 'Дубликат обращения' }));
    expect(out).toContain('Причина отклонения');
    expect(out).toContain('Дубликат обращения');
    expect(out).toContain('Отклонена');
  });

  it('блок причины не рендерится без rejected-статуса', () => {
    const out = html(row({ status: 'converted', rejectedReason: 'stale reason' }));
    expect(out).not.toContain('Причина отклонения');
    expect(out).not.toContain('stale reason');
  });

  it('вложения: список рендерится, при submitted дропзона видна', () => {
    const out = html(row({ status: 'submitted' }), [attachment()]);
    expect(out).toContain('Вложения');
    expect(out).toContain('договор.pdf');
    expect(out).toContain('Перетащите файл или нажмите для выбора');
    expect(out).not.toContain('добавление вложений недоступно');
  });

  it('in_triage: дропзона тоже видна', () => {
    const out = html(row({ status: 'in_triage' }));
    expect(out).toContain('Перетащите файл или нажмите для выбора');
  });

  it('converted: дропзоны нет, показана подсказка «рассмотрено»', () => {
    const out = html(row({ status: 'converted' }));
    expect(out).not.toContain('Перетащите файл');
    expect(out).toContain('Обращение рассмотрено — добавление вложений недоступно.');
  });

  it('rejected: дропзоны нет, показана подсказка «рассмотрено»', () => {
    const out = html(row({ status: 'rejected' }));
    expect(out).not.toContain('Перетащите файл');
    expect(out).toContain('Обращение рассмотрено — добавление вложений недоступно.');
  });

  it('пустой список вложений → «Пока нет вложений»', () => {
    expect(html(row(), [])).toContain('Пока нет вложений');
  });

describe('ClientRequestDetailView — крошки вместо ссылки «назад» (У-72)', () => {
  it('с крошками рисует их, а прежнюю ссылку убирает', () => {
    const out = html(row(), [], '/partner/requests', [
      { label: 'Обращения', href: '/partner/requests' },
      { label: 'Нужно обучение', href: null },
    ]);

    expect(out).toContain('Обращения');
    expect(out).not.toContain('← Все обращения');
  });

  it('пустой список крошек равносилен их отсутствию', () => {
    expect(html(row(), [], '/partner/requests', [])).toContain('← Все обращения');
  });
});
});
