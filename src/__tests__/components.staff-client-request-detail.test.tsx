// @vitest-environment jsdom
/**
 * Карточка обращения у сотрудника ЦО (`У-116`, `У-161`).
 *
 * Компонент один на три кабинета — администратора, руководителя и менеджера
 * (правило зеркала §0.2). Различается только основание адресов: «← Все
 * обращения» и крошки ведут в СВОЙ кабинет.
 *
 * Одно исключение записано прямо в коде: **ссылка на лид всегда ведёт в
 * кабинет менеджера**. У администратора и руководителя своего раздела лидов
 * нет, и ссылка в их кабинет привела бы на «страница не найдена».
 *
 * Вложения переводятся в вид для разметки: дата — строкой, потому что `Date`
 * через границу «сервер → клиент» не проходит.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Дочерние блоки подменены: здесь важно, ЧТО им передали, а не как они
// нарисованы — у каждого свой тест.
vi.mock('@/components/client-requests/client-request-detail-view', () => ({
  ClientRequestDetailView: (props: {
    backHref: string;
    breadcrumbs: Array<{ label: string; href: string | null }>;
    attachments: Array<{ id: string; createdAt: string }>;
    actions: React.ReactNode;
  }) => (
    <div
      data-testid="detail"
      data-back={props.backHref}
      data-crumbs={JSON.stringify(props.breadcrumbs)}
      data-attachments={JSON.stringify(props.attachments)}
    >
      {props.actions}
    </div>
  ),
}));
vi.mock('@/components/client-requests/client-request-staff-actions', () => ({
  ClientRequestStaffActions: (props: { leadHrefBase: string; canIssueProposal?: boolean }) => (
    <div
      data-testid="actions"
      data-lead-base={props.leadHrefBase}
      data-can-issue={String(props.canIssueProposal)}
    />
  ),
}));

import { StaffClientRequestDetail } from '@/components/client-requests/staff-client-request-detail';

const REQUEST = { id: 'cr1', subject: 'Обучение по охране труда', status: 'submitted' } as never;

const ATTACHMENT = {
  id: 'a1',
  name: 'договор.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  createdAt: new Date('2026-09-15T10:00:00Z'),
  createdByUserName: 'Партнёр 1',
} as never;

function render(over: Record<string, unknown> = {}) {
  const html = renderToString(
    <StaffClientRequestDetail
      cabinet="manager"
      request={REQUEST}
      attachments={[]}
      {...(over as never)}
    />
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    detail: doc.querySelector('[data-testid="detail"]') as HTMLElement,
    actions: doc.querySelector('[data-testid="actions"]') as HTMLElement,
  };
}

describe('Адреса кабинета', () => {
  it.each([
    ['менеджера', 'manager'],
    ['руководителя', 'leader'],
    ['администратора', 'admin'],
  ])('у %s возврат и крошки ведут в свой кабинет', (_name, cabinet) => {
    const { detail } = render({ cabinet });

    expect(detail.dataset.back).toBe(`/${cabinet}/requests`);
    expect(detail.dataset.crumbs).toContain(`/${cabinet}/requests`);
  });

  it('последняя крошка — тема обращения, чтобы человек видел, где он', () => {
    const { detail } = render();

    expect(detail.dataset.crumbs).toContain('Обучение по охране труда');
  });

  it('ссылка на лид ВСЕГДА ведёт к менеджеру — своих лидов у остальных нет', () => {
    for (const cabinet of ['manager', 'leader', 'admin']) {
      const { actions } = render({ cabinet });
      expect(actions.dataset.leadBase).toBe('/manager/leads');
    }
  });
});

describe('Вложения', () => {
  it('дата уходит СТРОКОЙ — `Date` через границу «сервер → клиент» не проходит', () => {
    const { detail } = render({ attachments: [ATTACHMENT] });

    const rows = JSON.parse(detail.dataset.attachments!) as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual({
      id: 'a1',
      name: 'договор.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      createdAt: '2026-09-15T10:00:00.000Z',
      createdByUserName: 'Партнёр 1',
    });
  });

  it('вложений нет — пустой список, а не «undefined»', () => {
    const { detail } = render();

    expect(JSON.parse(detail.dataset.attachments!)).toEqual([]);
  });
});

describe('Выпуск предложения', () => {
  it('страница разрешила — признак доезжает до кнопок', () => {
    expect(render({ canIssueProposal: true }).actions.dataset.canIssue).toBe('true');
  });

  it('страница не решала — кнопки её не показывают', () => {
    // Флаг выпуска документов читается на сервере, поэтому решение принимает
    // страница, а не разметка: умолчание — «нельзя».
    expect(render().actions.dataset.canIssue).toBe('false');
  });
});
