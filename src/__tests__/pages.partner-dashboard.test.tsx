// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

// Этап 4 (ФТ-10.4): страница читает зрителя через сервис welcome; welcomeSeenAt
// не-null → блок скрыт, старые сценарии этого файла его не касаются. Форма
// запроса пиннится в services.welcome.viewer.test.ts (аудит A1).
const { getWelcomeViewer } = vi.hoisted(() => ({ getWelcomeViewer: vi.fn() }));
vi.mock('@/lib/services/welcome/viewer', () => ({ getWelcomeViewer }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
// Этап 6 (`У-239`): блок «Первые шаги».
vi.mock('@/lib/services/partner/firstSteps', () => ({
  getPartnerFirstSteps: vi.fn(async () => ({
    items: [],
    doneCount: 0,
    dismissed: false,
    visible: false,
  })),
}));
vi.mock('@/server-actions/partner/firstSteps', () => ({ dismissPartnerFirstStepsAction: vi.fn() }));
vi.mock('@/components/dashboard/first-steps-card', () => ({ FirstStepsCard: () => null }));
// Этап 6 (`У-240`): блок «Ваш менеджер».
const { getPartnerYourManager } = vi.hoisted(() => ({
  getPartnerYourManager: vi.fn(async () => ({
    manager: { name: 'Анна', email: 'a@uc.ru' },
    othersCount: 0,
  })),
}));
vi.mock('@/lib/services/partner/yourManager', () => ({ getPartnerYourManager }));
vi.mock('@/components/dashboard/your-manager-card', () => ({
  YourManagerCard: (props: { view: { manager: { name: string } | null } }) =>
    React.createElement(
      'div',
      { 'data-testid': 'your-manager' },
      props.view.manager?.name ?? 'нет'
    ),
}));

// Флаги мокаем в off: этот файл пиннит базовый дашборд; карточки за флагами
// (заявки/удостоверения) покрыты в pages.dashboard.enrollments.test.tsx. Без
// мока флаг зависел бы от окружения (.env локально vs его отсутствие в CI).
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { kpis, attention, recentEvents, recentEnrollments, expiringCertificates } = vi.hoisted(
  () => ({
    kpis: vi.fn(),
    attention: vi.fn(),
    recentEvents: vi.fn(),
    recentEnrollments: vi.fn(),
    expiringCertificates: vi.fn(),
  })
);
vi.mock('@/lib/services/partner/dashboard', () => ({
  kpis,
  attention,
  recentEvents,
  recentEnrollments,
  expiringCertificates,
}));

import PartnerDashboard from '@/app/partner/dashboard/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

describe('PartnerDashboard', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
    getWelcomeViewer.mockReset();
    getWelcomeViewer.mockResolvedValue({ name: 'Партнёр', welcomeSeenAt: new Date('2026-01-01') });
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('renders KPIs, attention items, and events using the assigned-org scope', async () => {
    requirePartner.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({
      openOrders: 5,
      outstanding: '1000.00',
      commissionThisMonth: '300.00',
    });
    attention.mockResolvedValue({ stuckOrders: [], overdueOrders: [] });
    recentEvents.mockResolvedValue([]);
    // `У-262`: флаги заявок и удостоверений сняты — эти выборки теперь
    // выполняются всегда, поэтому у них должен быть ответ.
    recentEnrollments.mockResolvedValue([]);
    expiringCertificates.mockResolvedValue(null);

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(kpis).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      scopeOrgIds: ['org-1'],
    });
    expect(attention).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      scopeOrgIds: ['org-1'],
    });
    expect(recentEvents).toHaveBeenCalledWith(
      expect.anything(),
      { partnerId: 'p1', scopeOrgIds: ['org-1'] },
      10
    );
    expect(container.textContent).toContain('Главная');
    // welcomeSeenAt не-null → welcome-блока нет.
    expect(container.textContent).not.toContain('Добро пожаловать');
  });

  it('falls back to an empty scope array when the session has no assignedOrgIds', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: undefined });
    kpis.mockResolvedValue({
      openOrders: 0,
      outstanding: '0.00',
      commissionThisMonth: '0.00',
    });
    attention.mockResolvedValue({
      stuckOrders: [{ id: 'o1', title: 'Заказ', updatedAt: new Date('2024-01-01') }],
      overdueOrders: [],
    });
    recentEvents.mockResolvedValue([
      {
        kind: 'lead_created',
        title: 'Новый лид',
        at: new Date('2024-01-01'),
        ref: { kind: 'lead', id: 'l1' },
      },
    ]);

    await renderServerComponent(PartnerDashboard());

    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: [] });
  });
});
