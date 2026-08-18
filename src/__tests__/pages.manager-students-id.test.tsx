// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerStudentDetailPage from '@/app/manager/students/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
// §11 ТЗ v0.5 (этап 1 PR-3): страница подтягивает настраиваемые поля — мокаем
// сервис, иначе он полезет в реальный prisma. Обычная функция, а не vi.fn:
// в файле есть resetAllMocks, он снёс бы заготовленный ответ.
vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => [],
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getStudent } = vi.hoisted(() => ({ getStudent: vi.fn() }));
vi.mock('@/lib/services/manager/students', () => ({ getStudent }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training', () => ({ listCertificates }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/training/certificate-list', () => ({
  CertificateList: (props: { certificates: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'cert-list' }, JSON.stringify(props.certificates)),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

const STUDENT = {
  id: 's1',
  name: 'Иван Иванов',
  email: 'ivan@x.com',
  organizationId: 'org-1',
  createdAt: new Date('2024-01-01'),
  organization: { id: 'org-1', name: 'Org' },
};

// Scope-ветки (teamMode ON/OFF, чужая организация/company) переехали из
// страницы в сервис getStudent — покрываются unit-тестами
// services.manager.students.unit.test.ts, здесь остаётся контракт страницы.
describe('ManagerStudentDetailPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getStudent.mockReset();
    listCertificates.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when getStudent returns null (missing or out of scope)', async () => {
    requireManager.mockResolvedValue(SESSION);
    getStudent.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        ManagerStudentDetailPage({ params: Promise.resolve({ id: 'missing' }) })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(listCertificates).not.toHaveBeenCalled();
  });

  it('renders the student card with certificates', async () => {
    requireManager.mockResolvedValue(SESSION);
    getStudent.mockResolvedValue(STUDENT);
    listCertificates.mockResolvedValue({ ok: true, certificates: [{ id: 'cert1' }] });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('Иван Иванов');
    expect(container.textContent).toContain('Org');
    expect(container.textContent).toContain('cert1');
  });

  it('falls back to empty certificates when listCertificates returns ok:false', async () => {
    requireManager.mockResolvedValue(SESSION);
    getStudent.mockResolvedValue(STUDENT);
    listCertificates.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('Иван Иванов');
  });

  it('без почты и даты рождения экран говорит об этом словами, а не пустотой (§15)', async () => {
    // У рабочих почты часто нет, а СНИЛС и дату приносят позже (`У-21`).
    requireManager.mockResolvedValue(SESSION);
    getStudent.mockResolvedValue({ ...STUDENT, email: null, birthDate: null, snils: null });
    listCertificates.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('Почта не указана');
  });

  it('дата рождения показывается по-русски, когда она есть', async () => {
    requireManager.mockResolvedValue(SESSION);
    getStudent.mockResolvedValue({ ...STUDENT, birthDate: new Date('1990-02-01T00:00:00.000Z') });
    listCertificates.mockResolvedValue({ ok: true, rows: [] });

    const { container } = await renderServerComponent(
      ManagerStudentDetailPage({ params: Promise.resolve({ id: 's1' }) })
    );

    expect(container.textContent).toContain('1990');
  });
});
