import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EnrollmentDetailView } from '@/components/enrollment/enrollment-detail-view';
import type { EnrollmentDetail, EnrollmentDetailItem } from '@/lib/services/enrollments/detail';

function item(overrides: Partial<EnrollmentDetailItem> = {}): EnrollmentDetailItem {
  return {
    id: 'i1',
    studentId: null,
    fullName: 'Иван Петров',
    email: 'ivan@example.com',
    position: null,
    snils: null,
    birthDate: null,
    extra: null,
    status: 'pending',
    externalStudentId: null,
    directionName: null,
    certificateDocumentId: null,
    ...overrides,
  };
}

function detail(overrides: Partial<EnrollmentDetail> = {}): EnrollmentDetail {
  return {
    id: 'e1',
    directionName: 'Охрана труда',
    directionNames: [],
    status: 'pending',
    organizationName: null,
    partnerName: null,
    submittedByName: 'Партнёр 1',
    submitterRole: 'partner',
    note: null,
    rejectedReason: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    reviewedAt: null,
    provisionedAt: null,
    items: [item()],
    ...overrides,
  };
}

function renderView(d: EnrollmentDetail, backHref = '/organization/enrollments'): string {
  return renderToString(React.createElement(EnrollmentDetailView, { detail: d, backHref })).replace(
    /<!-- -->/g,
    ''
  );
}

describe('EnrollmentDetailView — шапка', () => {
  it('заголовок с направлением, кто подал и ссылка «назад» на backHref', () => {
    const html = renderView(detail(), '/partner/enrollments');
    expect(html).toContain('Заявка: Охрана труда');
    expect(html).toContain('Партнёр 1');
    expect(html).toContain('href="/partner/enrollments"');
    expect(html).toContain('← Все заявки на обучение');
  });

  it('организация в подзаголовке только когда organizationName задан', () => {
    expect(renderView(detail({ organizationName: 'ООО Ромашка' }))).toContain(
      'организация ООО Ромашка'
    );
    expect(renderView(detail())).not.toContain('организация');
  });

  it('статусная лента присутствует; для не-rejected есть подсказка про уведомления', () => {
    const html = renderView(detail({ status: 'in_training' }));
    expect(html).toContain('aria-label="Статус заявки"');
    expect(html).toContain('Статусы обновляет менеджер');
  });

  it('rejected: плашка с причиной вместо ленты, подсказки про уведомления нет', () => {
    const html = renderView(detail({ status: 'rejected', rejectedReason: 'Неполные данные' }));
    expect(html).toContain('Заявка отклонена: Неполные данные');
    expect(html).not.toContain('aria-label="Статус заявки"');
    expect(html).not.toContain('Статусы обновляет менеджер');
  });
});

describe('EnrollmentDetailView — несколько обучений в одной заявке (У-43)', () => {
  it('заголовок считает обучения, названия перечислены строкой ниже', () => {
    const html = renderView(
      detail({
        directionNames: ['Охрана труда', 'Работы на высоте'],
        items: [
          item({ id: 'i1', directionName: 'Охрана труда' }),
          item({ id: 'i2', fullName: 'Пётр Сидоров', directionName: 'Работы на высоте' }),
        ],
      })
    );
    expect(html).toContain('Заявка: 2 обучения');
    expect(html).toContain('Охрана труда · Работы на высоте');
  });

  it('позиции разложены по группам, у каждой — свой счётчик слушателей', () => {
    const html = renderView(
      detail({
        directionNames: ['Охрана труда', 'Работы на высоте'],
        items: [
          item({ id: 'i1', directionName: 'Охрана труда' }),
          item({ id: 'i2', fullName: 'Пётр Сидоров', directionName: 'Работы на высоте' }),
          item({ id: 'i3', fullName: 'Анна Кот', directionName: 'Охрана труда' }),
        ],
      })
    );
    expect(html).toContain('(2 слушателя)');
    expect(html).toContain('(1 слушатель)');
    // Нумерация внутри группы своя: третья позиция — вторая в своей группе.
    expect(html).toContain('2. Анна Кот');
  });

  it('старая заявка без направления у позиций — понятная группа-заглушка', () => {
    const html = renderView(detail());
    expect(html).toContain('Направление не указано');
    // Заголовок при одном направлении остаётся прежним.
    expect(html).toContain('Заявка: Охрана труда');
  });
});

describe('EnrollmentDetailView — позиции', () => {
  it('нумерованный список: ФИО, email, должность и статус-бейдж каждой позиции', () => {
    const html = renderView(
      detail({
        items: [
          item({ status: 'provisioned', position: 'инженер' }),
          item({
            id: 'i2',
            fullName: 'Анна Иванова',
            email: 'anna@example.com',
            status: 'in_training',
          }),
        ],
      })
    );
    expect(html).toContain('Слушатели (2)');
    expect(html).toContain('1. Иван Петров');
    expect(html).toContain('2. Анна Иванова');
    expect(html).toContain('ivan@example.com');
    expect(html).toContain('anna@example.com');
    expect(html).toContain('инженер');
    expect(html).toContain('Зачислены');
    expect(html).toContain('Идёт обучение');
  });

  it('кнопка «Скачать удостоверение» только у позиций с certificateDocumentId', () => {
    const html = renderView(
      detail({
        status: 'certificates_ready',
        items: [
          item({ status: 'certificates_ready', certificateDocumentId: 'doc-1' }),
          item({
            id: 'i2',
            fullName: 'Анна Иванова',
            email: 'anna@example.com',
            status: 'certificates_ready',
          }),
        ],
      })
    );
    expect(html.match(/Скачать удостоверение/g)).toHaveLength(1);
  });

  it('без certificateDocumentId кнопок скачивания нет вовсе', () => {
    const html = renderView(detail());
    expect(html).not.toContain('Скачать удостоверение');
  });

  it('certificates_ready без единой ссылки → подсказка «файлы появятся здесь…»', () => {
    const html = renderView(
      detail({ status: 'certificates_ready', items: [item({ status: 'certificates_ready' })] })
    );
    expect(html).toContain('файлы появятся здесь, когда менеджер загрузит их в систему');
  });

  it('certificates_ready с хотя бы одной ссылкой → подсказки нет', () => {
    const html = renderView(
      detail({
        status: 'certificates_ready',
        items: [
          item({ status: 'certificates_ready', certificateDocumentId: 'doc-1' }),
          item({
            id: 'i2',
            fullName: 'Анна Иванова',
            email: 'anna@example.com',
            status: 'certificates_ready',
          }),
        ],
      })
    );
    expect(html).not.toContain('файлы появятся здесь');
  });

  it('в других статусах подсказки про файлы нет даже без ссылок', () => {
    expect(
      renderView(detail({ status: 'in_training', items: [item({ status: 'in_training' })] }))
    ).not.toContain('файлы появятся здесь');
  });

  it('примечание рендерится только при наличии', () => {
    expect(renderView(detail({ note: 'срочная группа' }))).toContain('Примечание: срочная группа');
    expect(renderView(detail())).not.toContain('Примечание:');
  });
});
