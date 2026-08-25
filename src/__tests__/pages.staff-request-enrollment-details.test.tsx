// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const guards = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => guards);

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { getClientRequest } = vi.hoisted(() => ({ getClientRequest: vi.fn() }));
vi.mock('@/lib/services/clientRequests/list', () => ({ getClientRequest }));

const { listClientRequestAttachments } = vi.hoisted(() => ({
  listClientRequestAttachments: vi.fn(),
}));
vi.mock('@/lib/services/clientRequests/attachments', () => ({ listClientRequestAttachments }));

const { getEnrollmentRequest } = vi.hoisted(() => ({ getEnrollmentRequest: vi.fn() }));
vi.mock('@/lib/services/enrollments/detail', () => ({ getEnrollmentRequest }));

import AdminRequestDetailPage from '@/app/admin/requests/[id]/page';
import ManagerRequestDetailPage from '@/app/manager/requests/[id]/page';
import LeaderRequestDetailPage from '@/app/leader/requests/[id]/page';
import AdminEnrollmentDetailPage from '@/app/admin/enrollments/[id]/page';
import ManagerEnrollmentDetailPage from '@/app/manager/enrollments/[id]/page';
import LeaderEnrollmentDetailPage from '@/app/leader/enrollments/[id]/page';

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

const REQUEST = {
  id: 'r1',
  subject: 'Обучение по охране труда',
  status: 'submitted',
  companyName: 'ООО Ромашка',
  inn: '7701234567',
  contactName: 'Иван Петров',
  contactPhone: null,
  contactEmail: null,
  organizationName: null,
  partnerName: null,
  submittedByName: 'Иван Петров',
  source: 'website',
  body: 'Нужно обучить 5 человек',
  rejectedReason: null,
  createdAt: new Date('2026-08-01T10:00:00Z'),
};

const ENROLLMENT = {
  id: 'e1',
  status: 'pending',
  directionName: 'Электробезопасность',
  directionNames: ['Электробезопасность'],
  organizationName: 'ООО Ромашка',
  partnerName: null,
  submittedByName: 'Иван Петров',
  submitterRole: 'organization',
  note: null,
  rejectedReason: null,
  createdAt: new Date('2026-08-01T10:00:00Z'),
  reviewedAt: null,
  provisionedAt: null,
  items: [
    {
      id: 'i1',
      studentId: 's1',
      fullName: 'Сидоров',
      email: 's@b.c',
      position: null,
      snils: null,
      birthDate: null,
      extra: null,
      status: 'pending',
      externalStudentId: null,
      directionName: 'Электробезопасность',
      certificateDocumentId: null,
    },
  ],
};

beforeEach(() => {
  guards.requireAdmin.mockReset().mockResolvedValue({ sub: 'a1', role: 'admin' });
  guards.requireManager.mockReset().mockResolvedValue(SESSION);
  guards.requireManagerLeader.mockReset().mockResolvedValue({ ...SESSION, role: 'leader' });
  isFeatureEnabled.mockReset().mockReturnValue(true);
  notFound.mockClear();
  getClientRequest.mockReset().mockResolvedValue({ ok: true, request: REQUEST });
  listClientRequestAttachments.mockReset().mockResolvedValue({ ok: true, rows: [] });
  getEnrollmentRequest.mockReset().mockResolvedValue({ ok: true, request: ENROLLMENT });
});

const render = (page: (a: { params: Promise<{ id: string }> }) => unknown, id = 'x1') =>
  renderServerComponent(page({ params: Promise.resolve({ id }) }) as Promise<React.ReactNode>);

/**
 * `У-116`: деталок заявок и обращений у сотрудников ЦО не было. Обращение можно
 * было только развернуть строкой в очереди: поделиться ссылкой нельзя, открыть
 * из уведомления нельзя, «посмотри вот это обращение» означало «найди в списке
 * и разверни».
 */
describe('деталка обращения у сотрудников ЦО (У-116)', () => {
  it.each([
    ['админ', AdminRequestDetailPage, '/admin/requests'],
    ['менеджер', ManagerRequestDetailPage, '/manager/requests'],
    ['руководитель', LeaderRequestDetailPage, '/leader/requests'],
  ])('%s: экран открывается и ведёт обратно в свой кабинет', async (_n, page, listHref) => {
    const { container } = await render(page as never);
    expect(container.textContent).toContain('Обучение по охране труда');
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(listHref);
  });

  it('это ТОТ ЖЕ экран, что у клиента, плюс действия сотрудника', async () => {
    const { container } = await render(ManagerRequestDetailPage as never);
    // Данные обращения — как в клиентской деталке.
    expect(container.textContent).toContain('ООО Ромашка');
    expect(container.textContent).toContain('Нужно обучить 5 человек');
    // Плюс блок действий, которого у клиента нет.
    expect(container.textContent).toContain('Действия');
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      'Взять в работу'
    );
  });

  it('чужое обращение — «не найдено», а не пустая карточка', async () => {
    getClientRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(render(ManagerRequestDetailPage as never)).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('при выключенном флаге раздела экрана нет', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(render(ManagerRequestDetailPage as never)).rejects.toThrow('NOT_FOUND');
    // До сервиса дело не доходит: существование обращения не утекает.
    expect(getClientRequest).not.toHaveBeenCalled();
  });

  it('закрытое обращение объясняет, почему кнопок нет (§15)', async () => {
    getClientRequest.mockResolvedValue({
      ok: true,
      request: { ...REQUEST, status: 'rejected', rejectedReason: 'Не наш профиль' },
    });
    const { container } = await render(ManagerRequestDetailPage as never);
    expect(container.textContent).toContain('действий над ним больше нет');
    expect(container.textContent).toContain('Не наш профиль');
  });
});

describe('деталка заявки на обучение у сотрудников ЦО (У-116)', () => {
  it.each([
    ['админ', AdminEnrollmentDetailPage, '/admin/enrollments'],
    ['менеджер', ManagerEnrollmentDetailPage, '/manager/enrollments'],
    ['руководитель', LeaderEnrollmentDetailPage, '/leader/enrollments'],
  ])('%s: экран открывается и ведёт обратно в свой кабинет', async (_n, page, listHref) => {
    const { container } = await render(page as never);
    expect(container.textContent).toContain('Электробезопасность');
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(listHref);
  });

  it('действия сотрудника соответствуют состоянию заявки', async () => {
    const { container } = await render(ManagerEnrollmentDetailPage as never);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Утвердить');
    expect(labels).toContain('Отклонить');
    // Заявка ещё не утверждена — «Зачислены» предлагать рано.
    expect(labels).not.toContain('Зачислены');
  });

  it('чужая заявка — «не найдено»', async () => {
    getEnrollmentRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(render(ManagerEnrollmentDetailPage as never)).rejects.toThrow('NOT_FOUND');
  });

  it('пройденная заявка объясняет, почему кнопок нет (§15)', async () => {
    getEnrollmentRequest.mockResolvedValue({
      ok: true,
      request: {
        ...ENROLLMENT,
        status: 'certificates_ready',
        items: [{ ...ENROLLMENT.items[0], status: 'certificates_ready' }],
      },
    });
    const { container } = await render(ManagerEnrollmentDetailPage as never);
    expect(container.textContent).toContain('действий над ней больше нет');
  });
});
