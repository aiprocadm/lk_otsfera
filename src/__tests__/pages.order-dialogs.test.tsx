// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Блок «Переписка с клиентом» в карточке заказа у трёх кабинетов сотрудников
 * (`У-210`, этап 3 PR-6).
 *
 * Страница отвечает за три вещи, и все три легко сломать незаметно:
 *  · флаг `inbound_messaging` — выключен, значит блока нет ВОВСЕ и сервис не
 *    зовётся (пустая рамка на экране хуже отсутствия блока, а лишний запрос —
 *    плата за то, чего человек не просил);
 *  · заказ уходит в сервис целиком: тот сам решает, по контакту искать или по
 *    организации;
 *  · адреса: у менеджера и руководителя «Написать первым» ведёт к контакту
 *    заказа, у администратора ссылок нет вовсе (`/manager/*` — мёртвая дверь,
 *    Model A), а у заказа без контакта кнопки нет ни у кого.
 */

// ─── Общее для трёх страниц ─────────────────────────────────────────────────
const { requireAdmin, requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin,
  requireManager,
  requireManagerLeader,
}));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { student: {} } }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listOrderDialogs } = vi.hoisted(() => ({ listOrderDialogs: vi.fn() }));
vi.mock('@/lib/services/messengers/forOrder', () => ({ listOrderDialogs }));

/**
 * Зеркало пропсов вместо настоящего блока: сам блок проверен в
 * `components.order-dialogs-panel`, здесь важно, ЧТО в него передала страница.
 * `dialogHref` печатаем различая `null` и функцию — «ссылки нет» и «ссылка
 * есть» не должны склеиваться в одну проверку.
 */
vi.mock('@/components/orders/order-dialogs-panel', () => ({
  OrderDialogsPanel: (props: {
    dialogs: Array<{ id: string }>;
    total: number;
    dialogHref: ((id: string) => string) | null;
    writeFirstHref: string | null;
    allHref: string | null;
    hasContact: boolean;
  }) =>
    React.createElement('div', {
      'data-testid': 'order-dialogs',
      'data-ids': props.dialogs.map((d) => d.id).join(','),
      'data-total': props.total,
      'data-dialog-href': props.dialogHref === null ? 'null' : props.dialogHref('d-1'),
      'data-write-first': props.writeFirstHref ?? 'null',
      'data-all-href': props.allHref ?? 'null',
      'data-has-contact': String(props.hasContact),
    }),
}));

// ─── Сервисы карточки заказа (менеджер + руководитель) ──────────────────────
const { loadManagerOrderDetail, listOrderStudentOptions, loadOrderDeal } = vi.hoisted(() => ({
  loadManagerOrderDetail: vi.fn(),
  listOrderStudentOptions: vi.fn(),
  loadOrderDeal: vi.fn(),
}));
vi.mock('@/lib/services/manager/orderDetail', () => ({
  loadManagerOrderDetail,
  listOrderStudentOptions,
  loadOrderDeal,
}));
const { getDealActivity } = vi.hoisted(() => ({ getDealActivity: vi.fn() }));
vi.mock('@/lib/services/manager/dealActivity', () => ({ getDealActivity }));
const { listDirections } = vi.hoisted(() => ({ listDirections: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listDirections }));
const { getValuesForEntity } = vi.hoisted(() => ({ getValuesForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getValuesForEntity }));
const { getOrderReadiness } = vi.hoisted(() => ({ getOrderReadiness: vi.fn() }));
vi.mock('@/lib/services/manager/orderDelivery', () => ({ getOrderReadiness }));
const { listCertificateScanTargets } = vi.hoisted(() => ({ listCertificateScanTargets: vi.fn() }));
vi.mock('@/lib/services/manager/certificateScans', () => ({ listCertificateScanTargets }));
const { getOrderStatusPanel } = vi.hoisted(() => ({ getOrderStatusPanel: vi.fn() }));
vi.mock('@/lib/services/orderStatuses', () => ({ getOrderStatusPanel }));
const { getOrderLinesPanel } = vi.hoisted(() => ({ getOrderLinesPanel: vi.fn() }));
vi.mock('@/lib/services/orders/linesPanel', () => ({ getOrderLinesPanel }));
const { getDocumentGenerationPanel } = vi.hoisted(() => ({ getDocumentGenerationPanel: vi.fn() }));
vi.mock('@/lib/services/documents/generationPanel', () => ({ getDocumentGenerationPanel }));
const { getOrderContactPanel } = vi.hoisted(() => ({ getOrderContactPanel: vi.fn() }));
vi.mock('@/lib/services/orders/primaryContact', () => ({ getOrderContactPanel }));
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// ─── Сервисы карточки заказа (администратор) ────────────────────────────────
const { getOrderForAdmin } = vi.hoisted(() => ({ getOrderForAdmin: vi.fn() }));
vi.mock('@/lib/services/admin/orders', () => ({ getOrderForAdmin }));
const { listManagerCandidates } = vi.hoisted(() => ({ listManagerCandidates: vi.fn() }));
vi.mock('@/lib/services/admin/users', () => ({ listManagerCandidates }));

// ─── Соседние блоки карточки: к переписке отношения не имеют ────────────────
vi.mock('@/components/orders/order-lines-section', () => ({ OrderLinesSection: () => null }));
vi.mock('@/components/orders/order-contact-panel', () => ({ OrderContactPanel: () => null }));
vi.mock('@/components/manager/generate-documents-panel', () => ({
  GenerateDocumentsPanel: () => null,
}));
vi.mock('@/components/manager/order-readiness-panel', () => ({ OrderReadinessPanel: () => null }));
vi.mock('@/components/manager/certificate-scans-panel', () => ({
  CertificateScansPanel: () => null,
}));
vi.mock('@/components/admin/assign-order-manager-form', () => ({
  AssignOrderManagerForm: () => null,
}));
vi.mock('@/components/leader/leader-assign-order-manager-form', () => ({
  LeaderAssignOrderManagerForm: () => null,
}));
vi.mock('@/components/orders/merge-external-order-button', () => ({
  MergeExternalOrderButton: () => null,
}));
vi.mock('@/components/orders/order-custom-fields', () => ({ OrderCustomFields: () => null }));
vi.mock('@/components/orders/order-stage-stepper', () => ({ OrderStageStepper: () => null }));
// Панель документов администратора — клиентская и со своим состоянием; в этом
// тесте она только шумела бы предупреждениями React.
vi.mock('@/components/documents/documents-panel', () => ({ DocumentsPanel: () => null }));

// Менеджер и руководитель монтируют блок слотом общей «шапки» карточки —
// заглушка просто печатает слот, чтобы проверка была одинаковой у всех трёх.
vi.mock('@/components/manager/manager-order-detail-view', () => ({
  ManagerOrderDetailView: (props: { dialogsPanel?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'order-view' }, props.dialogsPanel),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

import AdminOrderPage from '@/app/admin/orders/[id]/page';
import LeaderOrderPage from '@/app/leader/orders/[id]/page';
import ManagerOrderPage from '@/app/manager/orders/[id]/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const, companyId: 'co-1' };
const MANAGER = { sub: 'm1', role: 'manager' as const, companyId: 'co-1' };

/** Заказ в том виде, в каком его отдаёт сервис кабинета сотрудника. */
const STAFF_ORDER = {
  id: 'order-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  orderNumber: '2024-001',
  title: 'Обучение по ОТ',
  executionStatus: 'in_progress',
  primaryContactId: 'ct-1',
  documents: [],
  payments: [],
  commentsCountByMe: 0,
};

const STAFF_DATA = {
  order: STAFF_ORDER,
  auditEntries: [],
  comments: [],
  documentRows: [],
  items: [],
};

/** Заказ в том виде, в каком его отдаёт сервис администратора. */
const ADMIN_ORDER = {
  id: 'order-1',
  orderNumber: '2024-001',
  title: 'Заказ на обучение',
  organization: { id: 'org-1', name: 'Org' },
  organizationId: 'org-1',
  companyId: 'co-1',
  partner: { name: 'Partner' },
  manager: null,
  managerId: null,
  totalAmount: 1000,
  paidAmount: 0,
  executionStatus: 'in_progress',
  financialStatus: 'unpaid',
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  primaryContactId: 'ct-1',
};

const DIALOGS = [
  {
    id: 'd-1',
    channel: 'telegram',
    status: 'waiting_staff',
    peerLabel: 'Иван Петров',
    lastMessageAt: new Date('2026-09-10T10:00:00Z'),
    lastMessagePreview: 'когда счёт?',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  requireManager.mockResolvedValue(MANAGER);
  requireManagerLeader.mockResolvedValue(LEADER);
  loadManagerOrderDetail.mockResolvedValue(STAFF_DATA);
  getOrderForAdmin.mockResolvedValue(ADMIN_ORDER);
  listManagerCandidates.mockResolvedValue([]);
  listOrderStudentOptions.mockResolvedValue([]);
  loadOrderDeal.mockResolvedValue(null);
  getDealActivity.mockResolvedValue({ ok: true, items: [] });
  listDirections.mockResolvedValue({ ok: true, directions: [] });
  getValuesForEntity.mockResolvedValue({ ok: true, fields: [] });
  getOrderReadiness.mockResolvedValue({
    ok: true,
    readiness: { ready: true, gaps: [], items: [] },
    deliveredAt: null,
  });
  listCertificateScanTargets.mockResolvedValue({ ok: true, targets: [] });
  getOrderStatusPanel.mockResolvedValue({
    current: null,
    forward: [],
    backward: [],
    terminal: null,
    history: [],
  });
  getOrderLinesPanel.mockResolvedValue(null);
  getDocumentGenerationPanel.mockResolvedValue({
    missingByType: { invoice: [], act: [], contract: [], extra_agreement: [] },
    hasInvoice: false,
    hasContract: false,
    baseDocuments: [],
    counterpartyName: 'ООО «Ромашка»',
    orderLines: [],
  });
  getOrderContactPanel.mockResolvedValue(null);
  getCompanyTeamVisibility.mockResolvedValue(false);
  listCompanyManagers.mockResolvedValue([]);
  listOrderDialogs.mockResolvedValue({ rows: DIALOGS, total: 7 });
});

type PageFn = (args: { params: Promise<{ id: string }> }) => Promise<React.ReactNode>;

async function renderPage(page: unknown) {
  const { container } = await renderServerComponent(
    (page as PageFn)({ params: Promise.resolve({ id: 'order-1' }) })
  );
  return container;
}

/** Только этот флаг — чтобы блок доказанно зависел от него, а не от соседа. */
function onlyDialogsFlag() {
  isFeatureEnabled.mockImplementation((flag: string) => flag === 'inbound_messaging');
}

const CABINETS = [
  { name: 'admin', page: AdminOrderPage, session: ADMIN },
  { name: 'leader', page: LeaderOrderPage, session: LEADER },
  { name: 'manager', page: ManagerOrderPage, session: MANAGER },
] as const;

describe('Блок «Переписка с клиентом» и флаг inbound_messaging (У-210)', () => {
  for (const { name, page, session } of CABINETS) {
    it(`${name}: флаг включён — блок смонтирован, заказ ушёл в сервис целиком`, async () => {
      onlyDialogsFlag();
      const container = await renderPage(page);
      const panel = container.querySelector('[data-testid="order-dialogs"]');

      expect(panel?.getAttribute('data-ids')).toBe('d-1');
      // Полное число доезжает до блока: иначе список молча обрезался бы (`С-6`).
      expect(panel?.getAttribute('data-total')).toBe('7');
      // Заказ передаётся целиком: по каким полям искать переписку — решение
      // сервиса, а не страницы.
      expect(listOrderDialogs).toHaveBeenCalledWith(
        prismaMock,
        session,
        expect.objectContaining({ organizationId: 'org-1', primaryContactId: 'ct-1' })
      );
    });

    it(`${name}: флаг выключен — блока нет и сервис не зовётся`, async () => {
      // Все прочие флаги включены: блок обязан исчезнуть от СВОЕГО флага.
      isFeatureEnabled.mockImplementation((flag: string) => flag !== 'inbound_messaging');
      const container = await renderPage(page);

      expect(container.querySelector('[data-testid="order-dialogs"]')).toBeNull();
      expect(listOrderDialogs).not.toHaveBeenCalled();
    });

    it(`${name}: пустая переписка блок не прячет — он объясняет, что дальше`, async () => {
      // Пустой блок — не «пустая рамка»: внутри пустое состояние с действием
      // (`У-74`), и прятать его нельзя.
      onlyDialogsFlag();
      listOrderDialogs.mockResolvedValue({ rows: [], total: 0 });
      const container = await renderPage(page);
      const panel = container.querySelector('[data-testid="order-dialogs"]');
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute('data-ids')).toBe('');
    });
  }
});

describe('Куда ведёт блок переписки в каждом кабинете', () => {
  it('менеджер: ссылка в диалог и «Написать первым» контакту заказа', async () => {
    onlyDialogsFlag();
    const container = await renderPage(ManagerOrderPage);
    const panel = container.querySelector('[data-testid="order-dialogs"]');

    expect(panel?.getAttribute('data-dialog-href')).toBe('/manager/messengers/d-1');
    expect(panel?.getAttribute('data-write-first')).toBe('/manager/messengers?new=ct-1');
    expect(panel?.getAttribute('data-has-contact')).toBe('true');
    // «Вся переписка» ведёт в СВОЙ кабинет: увести человека в чужой — сломать
    // ответ на вопрос «где я» (§15).
    expect(panel?.getAttribute('data-all-href')).toBe('/manager/organizations/org-1?tab=dialogs');
  });

  it('руководитель: те же адреса, что у менеджера (правило зеркала §0.2)', async () => {
    onlyDialogsFlag();
    const container = await renderPage(LeaderOrderPage);
    const panel = container.querySelector('[data-testid="order-dialogs"]');

    expect(panel?.getAttribute('data-dialog-href')).toBe('/manager/messengers/d-1');
    expect(panel?.getAttribute('data-write-first')).toBe('/manager/messengers?new=ct-1');
    // Раздела «Мессенджеры» у руководителя своего нет (играющий тренер), а
    // карточка организации — своя: за всей перепиской ведём к себе.
    expect(panel?.getAttribute('data-all-href')).toBe('/leader/organizations/org-1?tab=dialogs');
  });

  it('администратор: переписку видит, но ссылок у него нет (Model A)', async () => {
    onlyDialogsFlag();
    const container = await renderPage(AdminOrderPage);
    const panel = container.querySelector('[data-testid="order-dialogs"]');

    expect(panel?.getAttribute('data-dialog-href')).toBe('null');
    expect(panel?.getAttribute('data-write-first')).toBe('null');
    expect(panel?.getAttribute('data-has-contact')).toBe('true');
    // Карточка организации у администратора СВОЯ — туда ссылка живая.
    expect(panel?.getAttribute('data-all-href')).toBe('/admin/organizations/org-1?tab=dialogs');
  });

  it('заказ без организации: вести за «всей перепиской» некуда', async () => {
    onlyDialogsFlag();
    loadManagerOrderDetail.mockResolvedValue({
      ...STAFF_DATA,
      order: { ...STAFF_ORDER, organizationId: null },
    });
    getOrderForAdmin.mockResolvedValue({ ...ADMIN_ORDER, organizationId: null });

    for (const page of [ManagerOrderPage, LeaderOrderPage, AdminOrderPage]) {
      const container = await renderPage(page);
      expect(
        container.querySelector('[data-testid="order-dialogs"]')?.getAttribute('data-all-href')
      ).toBe('null');
    }
  });

  it('заказ без контакта: кнопки нет ни у менеджера, ни у руководителя', async () => {
    onlyDialogsFlag();
    loadManagerOrderDetail.mockResolvedValue({
      ...STAFF_DATA,
      order: { ...STAFF_ORDER, primaryContactId: null },
    });

    for (const page of [ManagerOrderPage, LeaderOrderPage]) {
      const container = await renderPage(page);
      const panel = container.querySelector('[data-testid="order-dialogs"]');
      expect(panel?.getAttribute('data-write-first')).toBe('null');
      // Блок сам скажет, что связать разговор не с кем.
      expect(panel?.getAttribute('data-has-contact')).toBe('false');
    }
  });

  it('заказ без контакта у администратора — тот же честный ответ', async () => {
    onlyDialogsFlag();
    getOrderForAdmin.mockResolvedValue({ ...ADMIN_ORDER, primaryContactId: null });
    const container = await renderPage(AdminOrderPage);
    expect(
      container.querySelector('[data-testid="order-dialogs"]')?.getAttribute('data-has-contact')
    ).toBe('false');
  });

  it('идентификатор контакта в адресе экранируется', async () => {
    // Контакты приезжают из Битрикс24 — идентификатор не обязан быть
    // безопасным для адреса.
    onlyDialogsFlag();
    loadManagerOrderDetail.mockResolvedValue({
      ...STAFF_DATA,
      order: { ...STAFF_ORDER, primaryContactId: 'a&b=1' },
    });
    const container = await renderPage(ManagerOrderPage);
    expect(
      container.querySelector('[data-testid="order-dialogs"]')?.getAttribute('data-write-first')
    ).toBe('/manager/messengers?new=a%26b%3D1');
  });
});
