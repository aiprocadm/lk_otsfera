// @vitest-environment jsdom
/**
 * Блоки карточки документа у сотрудников ЦО (`У-251`, `У-254`).
 *
 * Соседний тест (`pages.document-detail`) проверяет гарды и адреса ссылок и
 * держит историю «не найдена». Здесь — вторая половина: что появляется, когда
 * история **есть** и когда документу разрешена новая версия.
 *
 * Правило зеркала (§0.2): у менеджера и руководителя блоки одни и те же, и
 * ведут они каждый в свой кабинет. Блок «через одного» — дефект приёмки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Дочерние блоки подменены заглушками: здесь проверяется, КАКИЕ блоки карточка
// собирает и с чем, а не их вёрстка — у каждого свой тест.
vi.mock('@/components/documents/document-detail-view', () => ({
  DocumentDetailView: (props: { children: React.ReactNode; backHref: string }) => (
    <div data-testid="detail" data-back={props.backHref}>
      {props.children}
    </div>
  ),
}));
vi.mock('@/components/documents/document-onec-push-block', () => ({
  DocumentOneCPushBlock: (props: { pushedVersionInOneC: number | null }) => (
    <div data-testid="push-block" data-pushed={String(props.pushedVersionInOneC)} />
  ),
}));
vi.mock('@/components/documents/document-version-upload-form', () => ({
  DocumentVersionUploadForm: (props: { url: string; currentVersion: number }) => (
    <div
      data-testid="version-upload"
      data-url={props.url}
      data-version={String(props.currentVersion)}
    />
  ),
}));
vi.mock('@/components/documents/document-version-history', () => ({
  DocumentVersionHistory: (props: { hrefBase: string }) => (
    <div data-testid="version-history" data-base={props.hrefBase} />
  ),
}));
vi.mock('@/components/documents/document-downloads', () => ({
  DocumentDownloads: (props: { auditHref: string | null }) => (
    <div data-testid="downloads" data-audit={String(props.auditHref)} />
  ),
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => <div data-testid="custom-fields" />,
}));
vi.mock('@/components/tasks/linked-tasks-panel', () => ({
  LinkedTasksPanel: () => <div data-testid="tasks" />,
}));

import { StaffDocumentDetail } from '@/components/documents/staff-document-detail';

const doc = (over: Record<string, unknown> = {}) =>
  ({
    id: 'doc1',
    name: 'Счёт №5',
    type: 'invoice',
    version: 3,
    canUploadVersion: false,
    order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' },
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    oneCPush: {
      status: 'none',
      pushedAt: null,
      error: null,
      attempts: 0,
      externalId: null,
      blocked: null,
    },
    ...over,
  }) as never;

const history = {
  versions: [],
  downloads: [],
  pushedVersionInOneC: 2,
} as never;

function mount(props: Record<string, unknown> = {}) {
  return render(
    <StaffDocumentDetail cabinet="manager" document={doc()} customFields={[]} {...props} />
  );
}

beforeEach(() => vi.clearAllMocks());

describe('История документа', () => {
  it('истории нет — версий и скачиваний тоже нет', () => {
    mount();

    expect(screen.queryByTestId('version-history')).toBeNull();
    expect(screen.queryByTestId('downloads')).toBeNull();
    // Версия в 1С неизвестна — так и передаём, а не выдумываем ноль.
    expect(screen.getByTestId('push-block').dataset.pushed).toBe('null');
  });

  it('история есть — оба блока на месте и ведут в свой кабинет', () => {
    mount({ history });

    expect(screen.getByTestId('version-history').dataset.base).toBe('/manager/documents');
    expect(screen.getByTestId('push-block').dataset.pushed).toBe('2');
    // Журнал действий — раздел администратора; у сотрудников его нет.
    expect(screen.getByTestId('downloads').dataset.audit).toBe('null');
  });

  it('у руководителя те же блоки, только свой кабинет', () => {
    mount({ cabinet: 'leader', history });

    expect(screen.getByTestId('detail').dataset.back).toBe('/leader/documents');
    expect(screen.getByTestId('version-history').dataset.base).toBe('/leader/documents');
  });
});

describe('Загрузка новой версии', () => {
  it('сервер не разрешил — формы нет', () => {
    mount();

    expect(screen.queryByTestId('version-upload')).toBeNull();
  });

  it('разрешил — форма знает дверь заказа и текущую версию', () => {
    mount({ document: doc({ canUploadVersion: true }) });

    const form = screen.getByTestId('version-upload');
    expect(form.dataset.url).toBe('/api/manager/documents/ord1/upload');
    expect(form.dataset.version).toBe('3');
  });

  it('документ без заказа уходит в свою дверь, а не теряет кнопку', () => {
    mount({ document: doc({ canUploadVersion: true, order: null }) });

    expect(screen.getByTestId('version-upload').dataset.url).toBe(
      '/api/manager/documents/order-less'
    );
  });
});

describe('Задачи по документу', () => {
  it('раздел выключен — блока нет', () => {
    mount({ tasks: null, currentUserId: 'u1' });

    expect(screen.queryByTestId('tasks')).toBeNull();
  });

  it('раздел включён — блок на месте', () => {
    mount({ tasks: [], currentUserId: 'u1' });

    // Пустой список задач — всё равно блок: из него заводят первую задачу.
    expect(screen.getByTestId('tasks')).toBeTruthy();
  });

  it('пользователь неизвестен — блока нет, некому назначать', () => {
    mount({ tasks: [] });

    expect(screen.queryByTestId('tasks')).toBeNull();
  });
});
