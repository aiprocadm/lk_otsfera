// @vitest-environment jsdom
/**
 * §11 ТЗ v0.5 (этап 1 PR-4) — страницы карточки документа по кабинетам.
 * С `У-110` у руководителя своя страница: экран общий с менеджером
 * (`StaffDocumentDetail`), различается только кабинет ссылок.
 *
 * Проверяем три вещи: сработал гард своего кабинета, отказ сервиса даёт 404
 * (а не пустую страницу), ссылки ведут в СВОЙ кабинет, а не в чужой.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const { requireAdmin, requireManager, requireManagerLeader, requirePartner } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
  requirePartner: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin,
  requireManager,
  requireManagerLeader,
  requirePartner,
}));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getDocumentDetail } = vi.hoisted(() => ({ getDocumentDetail: vi.fn() }));
vi.mock('@/lib/services/documents/detail', () => ({ getDocumentDetail }));

// `У-251`, `У-254`: страницы сотрудников спрашивают ещё и историю документа.
// Здесь проверяются гарды и адреса ссылок, поэтому история — пустой отказ:
// её содержимое проверяет свой тест сервиса.
const { getDocumentHistory } = vi.hoisted(() => ({
  getDocumentHistory: vi.fn(async () => ({ ok: false as const, error: 'not_found' as const })),
}));
vi.mock('@/lib/services/documents/history', () => ({ getDocumentHistory }));

vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => [],
}));

// `У-220`: блок «Задачи» на карточке живёт вместе с самим разделом задач, а он
// под opt-in флагом. По умолчанию держим флаг выключенным — как в бою.
const { isFeatureEnabled, listLinkedTasks } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(() => false),
  // Тип аргументов объявлен явно: без него `mock.calls` — пустой кортеж, и
  // обращение к `calls[0][2]` не проходит проверку типов.
  listLinkedTasks: vi.fn<(prisma: unknown, session: unknown, link: unknown) => Promise<unknown[]>>(
    async () => [{ id: 't1', title: 'Проверить оплату' }]
  ),
}));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/tasks/board', () => ({ listLinkedTasks }));

vi.mock('@/components/documents/document-detail-view', () => ({
  DocumentDetailView: (props: {
    backHref: string;
    orderHrefBase?: string;
    document: { name: string };
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'doc-card' },
      JSON.stringify({
        name: props.document.name,
        backHref: props.backHref,
        orderHrefBase: props.orderHrefBase,
      }),
      // Блоки страницы приходят ДЕТЬМИ карточки (форма замены версии, история,
      // скачивания). Не отрисуй их заглушка — проверить, есть ли блок у этого
      // кабинета, было бы нечем.
      props.children
    ),
}));

vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => React.createElement('div', { 'data-testid': 'fields' }),
}));

// Блоки внутреннего контура: у каждого свой тест, а здесь они мешали бы —
// часть из них клиентские, с состоянием, и серверный рендер на них падает.
vi.mock('@/components/documents/document-onec-push-block', () => ({
  DocumentOneCPushBlock: () => React.createElement('div', { 'data-testid': 'push-block' }),
}));
vi.mock('@/components/documents/document-version-history', () => ({
  DocumentVersionHistory: () => React.createElement('div', { 'data-testid': 'version-history' }),
}));
vi.mock('@/components/documents/document-downloads', () => ({
  DocumentDownloads: () => React.createElement('div', { 'data-testid': 'downloads' }),
}));
vi.mock('@/components/tasks/linked-tasks-panel', () => ({
  LinkedTasksPanel: () => React.createElement('div', { 'data-testid': 'tasks' }),
}));

// `У-251`: форма замены версии. Здесь важно, ЕСТЬ ли она у кабинета и в какую
// дверь целится, а не как она нарисована — у формы свой тест.
vi.mock('@/components/documents/document-version-upload-form', () => ({
  DocumentVersionUploadForm: (props: { url: string; fields: Record<string, string> }) =>
    React.createElement('div', {
      'data-testid': 'version-upload',
      'data-url': props.url,
      'data-fields': JSON.stringify(props.fields),
    }),
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-shell' }, children),
}));

import AdminDocumentPage from '@/app/admin/documents/[id]/page';
import ManagerDocumentPage from '@/app/manager/documents/[id]/page';
import LeaderDocumentPage from '@/app/leader/documents/[id]/page';
import PartnerDocumentPage from '@/app/partner/documents/[id]/page';
import OrganizationDocumentPage from '@/app/organization/documents/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const DOC = { ok: true, document: { name: 'Счёт №5' } };

const ORG_CTX = {
  session: { sub: 'org1', role: 'organization', email: 'o@t.local' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin',
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ sub: 'a1', role: 'admin' });
  requireManager.mockReset().mockResolvedValue({ sub: 'm1', role: 'manager' });
  requireManagerLeader.mockReset().mockResolvedValue({ sub: 'l1', role: 'leader' });
  requirePartner.mockReset().mockResolvedValue({ sub: 'p1', role: 'partner', partnerId: 'pp1' });
  getOrgPageContext.mockReset().mockResolvedValue(ORG_CTX);
  getDocumentDetail.mockReset().mockResolvedValue(DOC);
  notFound.mockClear();
});

describe('Карточка документа — кабинет администратора', () => {
  it('гард админа, ссылки в свой кабинет', async () => {
    const { container } = await renderServerComponent(
      AdminDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requireAdmin).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/admin/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/admin/orders"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(AdminDocumentPage({ params: Promise.resolve({ id: 'nope' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

describe('Карточка документа — кабинет менеджера', () => {
  it('гард менеджера, ссылки в свой кабинет', async () => {
    const { container } = await renderServerComponent(
      ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requireManager).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/manager/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/manager/orders"');
    expect(container.textContent).not.toContain('/admin/');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(ManagerDocumentPage({ params: Promise.resolve({ id: 'x' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Карточка документа — кабинет руководителя (У-110)', () => {
  it('гард руководителя, ссылки в свой кабинет, а не в менеджерский', async () => {
    const { container } = await renderServerComponent(
      LeaderDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requireManagerLeader).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/leader/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/leader/orders"');
    expect(container.textContent).not.toContain('/manager/');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(LeaderDocumentPage({ params: Promise.resolve({ id: 'x' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Карточка документа — задачи и история (`У-220`, `У-251`)', () => {
  it('задачи спрашиваются только при включённом разделе — иначе блок пустой', async () => {
    // Выключенный раздел задач и лишний запрос в него — разные вещи: спросить
    // сервис при выключенном флаге значит показать человеку блок, которого в
    // меню нет.
    isFeatureEnabled.mockReturnValue(false);
    await renderServerComponent(ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) }));
    expect(listLinkedTasks).not.toHaveBeenCalled();

    isFeatureEnabled.mockReturnValue(true);
    await renderServerComponent(ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) }));
    expect(listLinkedTasks).toHaveBeenCalledTimes(1);
    expect(listLinkedTasks.mock.calls[0]![2]).toEqual({ documentId: 'd1' });

    // Правило зеркала: у руководителя тот же экран и та же выборка.
    listLinkedTasks.mockClear();
    await renderServerComponent(LeaderDocumentPage({ params: Promise.resolve({ id: 'd1' }) }));
    expect(listLinkedTasks.mock.calls[0]![2]).toEqual({ documentId: 'd1' });
  });

  it('история версий доезжает до экрана, когда выборка удалась', async () => {
    // Отказ выборки проверяется остальными тестами файла (там она всегда
    // отвечает отказом). Здесь — обратный случай: строки истории обязаны
    // доехать, иначе «Кто скачивал» молча пуст у всех.
    getDocumentHistory.mockResolvedValue({
      ok: true as const,
      history: { versions: [], downloads: [], pushedVersionInOneC: null },
    } as never);
    const { container } = await renderServerComponent(
      ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    // Оба блока приходят ДЕТЬМИ карточки; без истории их не было бы вовсе.
    expect(container.querySelector('[data-testid="version-history"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="downloads"]')).toBeTruthy();

    // И обратная сторона: отказ выборки не рисует пустых блоков-обманок.
    getDocumentHistory.mockResolvedValue({ ok: false as const, error: 'not_found' } as never);
    const denied = await renderServerComponent(
      ManagerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(denied.container.querySelector('[data-testid="version-history"]')).toBeNull();
    expect(denied.container.querySelector('[data-testid="downloads"]')).toBeNull();
  });
});

describe('Карточка документа — кабинет партнёра', () => {
  it('гард партнёра, заказы ведут в «Сделки» его кабинета', async () => {
    const { container } = await renderServerComponent(
      PartnerDocumentPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(requirePartner).toHaveBeenCalled();
    expect(container.textContent).toContain('"backHref":"/partner/documents"');
    expect(container.textContent).toContain('"orderHrefBase":"/partner/orders"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(PartnerDocumentPage({ params: Promise.resolve({ id: 'x' }) }))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Карточка документа — кабинет организации', () => {
  it('рендерится внутри оболочки организации, сессия берётся из контекста', async () => {
    const { container } = await renderServerComponent(
      OrganizationDocumentPage({
        params: Promise.resolve({ id: 'd1' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(getOrgPageContext).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="org-shell"]')).toBeTruthy();
    expect(getDocumentDetail).toHaveBeenCalledWith({}, ORG_CTX.session, 'd1');
    expect(container.textContent).toContain('"backHref":"/organization/documents"');
  });

  it('недоступный документ → notFound()', async () => {
    getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      renderServerComponent(
        OrganizationDocumentPage({
          params: Promise.resolve({ id: 'x' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

/**
 * Замена версии документа у клиентских кабинетов (`У-251`).
 *
 * Дверей загрузки пять, и у каждой свой набор полей. Важно, что **кабинет
 * целится в СВОЮ дверь**: перепутай их — и файл уйдёт туда, куда у этой роли
 * нет прав, а человек увидит отказ вместо замены.
 *
 * Форма появляется, только когда сервер разрешил (`canUploadVersion`). Кнопка
 * на экране правами не считается: сервис проверит всё заново.
 */
describe('Замена версии документа — клиентские кабинеты', () => {
  /** Карточка документа, которому сервер разрешил новую версию. */
  const allowed = (counterparty: { type: string; id: string | null }) => ({
    ok: true,
    document: {
      name: 'Счёт №5',
      type: 'invoice',
      version: 2,
      canUploadVersion: true,
      order: { id: 'ord1' },
      counterparty,
    },
  });

  it('партнёр целится в свою дверь; партнёра в полях нет — он в сессии', async () => {
    getDocumentDetail.mockResolvedValue(allowed({ type: 'partner', id: 'pp1' }));

    const { container } = await renderServerComponent(
      PartnerDocumentPage({ params: Promise.resolve({ id: 'doc1' }) })
    );

    const form = container.querySelector('[data-testid="version-upload"]') as HTMLElement;
    expect(form.dataset.url).toBe('/api/partner/documents/upload');
    expect(JSON.parse(form.dataset.fields!)).toEqual({ orderId: 'ord1', docType: 'invoice' });
  });

  it('заказчик целится в свою дверь и несёт организацию документа', async () => {
    getDocumentDetail.mockResolvedValue(allowed({ type: 'organization', id: 'org-7' }));

    const { container } = await renderServerComponent(
      OrganizationDocumentPage({
        params: Promise.resolve({ id: 'doc1' }),
        searchParams: Promise.resolve({}),
      })
    );

    const form = container.querySelector('[data-testid="version-upload"]') as HTMLElement;
    expect(form.dataset.url).toBe('/api/organization/documents/upload');
    // Организация берётся у САМОГО документа, а не из активной вкладки шапки:
    // у человека их может быть несколько, и файл ушёл бы не в ту папку.
    expect(JSON.parse(form.dataset.fields!)).toMatchObject({ organizationId: 'org-7' });
  });

  it.each([
    ['партнёра', PartnerDocumentPage, { type: 'organization', id: 'org-7' }],
    ['заказчика', OrganizationDocumentPage, { type: 'partner', id: 'pp1' }],
  ])('чужой контрагент — формы у %s нет вовсе', async (_name, Page, counterparty) => {
    getDocumentDetail.mockResolvedValue(allowed(counterparty));

    const { container } = await renderServerComponent(
      // Обе страницы принимают параметры адреса; у партнёрской они не нужны,
      // но общий вызов проще, чем две ветки в одном сценарии.
      Page({
        params: Promise.resolve({ id: 'doc1' }),
        searchParams: Promise.resolve({}),
      } as never)
    );

    expect(container.querySelector('[data-testid="version-upload"]')).toBeNull();
  });

  it('сервер не разрешил замену — формы нет', async () => {
    const doc = allowed({ type: 'partner', id: 'pp1' });
    doc.document.canUploadVersion = false;
    getDocumentDetail.mockResolvedValue(doc);

    const { container } = await renderServerComponent(
      PartnerDocumentPage({ params: Promise.resolve({ id: 'doc1' }) })
    );

    expect(container.querySelector('[data-testid="version-upload"]')).toBeNull();
  });
});
