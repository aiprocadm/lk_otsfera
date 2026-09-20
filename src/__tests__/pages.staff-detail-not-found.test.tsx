// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Карточки обращений, заявок на обучение и «Показателей и планов» в кабинетах
 * сотрудников (`У-116`, `У-242`).
 *
 * Проверяется одна общая обязанность, которую легко забыть: **чужая запись
 * неотличима от несуществующей**. Сервис режет скоуп и отвечает отказом, а
 * страница обязана показать «не найдено», а не пустую карточку — иначе по
 * наличию экрана можно узнать, что такая запись существует у соседей.
 *
 * Вторая обязанность — **вложения не обязательны**: если их список не
 * прочитался, карточка обращения всё равно открывается, только без файлов.
 */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn(),
  requireSettingsSection: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getClientRequest: vi.fn(),
  listClientRequestAttachments: vi.fn(),
  getEnrollmentRequest: vi.fn(),
  getKpiSettings: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND');
  }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin: mocks.requireAdmin,
  requireManagerLeader: mocks.requireManagerLeader,
}));
vi.mock('@/lib/auth/requireSettings', () => ({
  requireSettingsSection: mocks.requireSettingsSection,
}));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('@/lib/services/clientRequests/list', () => ({ getClientRequest: mocks.getClientRequest }));
vi.mock('@/lib/services/clientRequests/attachments', () => ({
  listClientRequestAttachments: mocks.listClientRequestAttachments,
}));
vi.mock('@/lib/services/enrollments/detail', () => ({
  getEnrollmentRequest: mocks.getEnrollmentRequest,
}));
vi.mock('@/lib/services/kpi/settings', () => ({ getKpiSettings: mocks.getKpiSettings }));

// Экраны подменены заглушками: здесь проверяется обязанность страницы, а не
// вёрстка карточки — у каждой из них свой тест.
vi.mock('@/components/client-requests/staff-client-request-detail', () => ({
  StaffClientRequestDetail: (props: Record<string, unknown>) => (
    <div data-testid="request-detail" data-attachments={(props.attachments as unknown[]).length}>
      карточка обращения
    </div>
  ),
}));
vi.mock('@/components/enrollment/staff-enrollment-detail', () => ({
  StaffEnrollmentDetail: () => <div data-testid="enrollment-detail">карточка заявки</div>,
}));
vi.mock('@/components/kpi/kpi-settings-screen', () => ({
  KpiSettingsScreen: () => <div data-testid="kpi-screen">показатели</div>,
}));

import AdminRequestPage from '@/app/admin/requests/[id]/page';
import LeaderRequestPage from '@/app/leader/requests/[id]/page';
import AdminEnrollmentPage from '@/app/admin/enrollments/[id]/page';
import LeaderEnrollmentPage from '@/app/leader/enrollments/[id]/page';
import LeaderKpiPage from '@/app/leader/settings/processes/kpi/page';

const SESSION = { sub: 'u1', role: 'admin', email: 'a@x.ru', companyId: 'c1' };
const params = Promise.resolve({ id: 'r1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(SESSION);
  mocks.requireManagerLeader.mockResolvedValue({ ...SESSION, role: 'leader' });
  mocks.requireSettingsSection.mockResolvedValue({ ...SESSION, role: 'leader' });
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.getClientRequest.mockResolvedValue({ ok: true, request: { id: 'r1' } });
  mocks.listClientRequestAttachments.mockResolvedValue({ ok: true, rows: [{ id: 'f1' }] });
  mocks.getEnrollmentRequest.mockResolvedValue({ ok: true, request: { id: 'e1' } });
  mocks.getKpiSettings.mockResolvedValue({ ok: true, view: {} });
});

describe('Карточка обращения — обе роли', () => {
  it.each([
    ['администратор', () => AdminRequestPage({ params })],
    ['руководитель', () => LeaderRequestPage({ params })],
  ])('%s: чужое обращение неотличимо от несуществующего', async (_role, open) => {
    mocks.getClientRequest.mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(renderServerComponent(open())).rejects.toThrow('NOTFOUND');
  });

  it.each([
    ['администратор', () => AdminRequestPage({ params })],
    ['руководитель', () => LeaderRequestPage({ params })],
  ])('%s: вложения не прочитались — карточка всё равно открывается', async (_role, open) => {
    mocks.listClientRequestAttachments.mockResolvedValue({ ok: false, error: 'storage' });

    await renderServerComponent(open());

    expect(screen.getByTestId('request-detail').dataset.attachments).toBe('0');
  });

  it('вложения прочитались — они на месте', async () => {
    await renderServerComponent(AdminRequestPage({ params }));

    expect(screen.getByTestId('request-detail').dataset.attachments).toBe('1');
  });
});

describe('Карточка заявки на обучение — обе роли', () => {
  it.each([
    ['администратор', () => AdminEnrollmentPage({ params })],
    ['руководитель', () => LeaderEnrollmentPage({ params })],
  ])('%s: чужая заявка отвечает «не найдено»', async (_role, open) => {
    mocks.getEnrollmentRequest.mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(renderServerComponent(open())).rejects.toThrow('NOTFOUND');
  });

  it('своя заявка открывается', async () => {
    await renderServerComponent(AdminEnrollmentPage({ params }));

    expect(screen.getByTestId('enrollment-detail')).toBeTruthy();
  });
});

describe('«Показатели и планы» руководителя', () => {
  it('сервис отказал — «не найдено», а не пустой экран', async () => {
    mocks.getKpiSettings.mockResolvedValue({ ok: false, error: 'forbidden' });

    await expect(
      renderServerComponent(LeaderKpiPage({ searchParams: Promise.resolve({}) }))
    ).rejects.toThrow('NOTFOUND');
  });

  it('месяц из адреса доходит до сервиса', async () => {
    await renderServerComponent(
      LeaderKpiPage({ searchParams: Promise.resolve({ month: '2026-03' }) })
    );

    expect(mocks.getKpiSettings).toHaveBeenCalledWith({}, expect.anything(), {
      year: 2026,
      month: 3,
    });
    expect(screen.getByTestId('kpi-screen')).toBeTruthy();
  });
});
