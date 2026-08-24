// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationCompanyStudentPage from '@/app/organization/company/students/[studentId]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Этап 3 PR-1 (ФТ-6.3): карточка сотрудника организации — флаг off → notFound;
 * чужой/несуществующий сотрудник → notFound; успех → шапка, удостоверения,
 * история обучения со статусами.
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
// §11 ТЗ v0.5 (этап 1 PR-3): страница подтягивает настраиваемые поля — мокаем
// сервис, иначе он полезет в реальный prisma. Обычная функция, а не vi.fn:
// в файле есть resetAllMocks, он снёс бы заготовленный ответ.
vi.mock('@/lib/services/customFields', () => ({
  getFieldsForEntity: async () => [],
}));

vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getOrgStudent, listOrgStudentTraining } = vi.hoisted(() => ({
  getOrgStudent: vi.fn(),
  listOrgStudentTraining: vi.fn(),
}));
vi.mock('@/lib/services/organization/students', () => ({ getOrgStudent, listOrgStudentTraining }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training/certificates', async (importOriginal) => {
  // certificateStatus нужен настоящий (его использует бейдж в таблице реестра).
  const mod = await importOriginal<typeof import('@/lib/services/training/certificates')>();
  return { ...mod, listCertificates };
});

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

const STUDENT = {
  id: 's1',
  name: 'Иванов Иван',
  email: 'ivanov@x.ru',
  externalStudentId: 'EXT-9',
  createdAt: new Date('2026-01-01'),
};

const props = (id: string) => ({
  params: Promise.resolve({ studentId: id }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  vi.resetAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  listCertificates.mockResolvedValue({ ok: true, certificates: [], total: 0 });
  listOrgStudentTraining.mockResolvedValue([]);
});

describe('Карточка сотрудника в «Моей организации» (У-97, У-100)', () => {
  it('флаг off → notFound, контекст не запрашивается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(OrganizationCompanyStudentPage(props('s1')))).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('чужой/несуществующий сотрудник → notFound (скоуп активной организации)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue(null);
    await expect(
      renderServerComponent(OrganizationCompanyStudentPage(props('foreign')))
    ).rejects.toThrow('NOT_FOUND');
    expect(getOrgStudent).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      studentId: 'foreign',
    });
    expect(listCertificates).not.toHaveBeenCalled();
  });

  it('сбой сервиса удостоверений деградирует в пустой список, карточка открывается', async () => {
    // Удостоверения — дополнительный блок карточки. Их отказ не должен закрывать
    // сотруднику доступ к самой карточке (принцип §3: деградируем, не роняем).
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue(STUDENT);
    listCertificates.mockResolvedValue({ ok: false, error: 'forbidden' });
    listOrgStudentTraining.mockResolvedValue([]);

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('s1')));

    expect(container.textContent).toContain('Иванов Иван');
    expect(container.textContent).not.toContain('УД-1');
  });

  it('успех: шапка + удостоверения + история обучения (статус по-русски, ссылка на заказ)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue(STUDENT);
    listCertificates.mockResolvedValue({
      ok: true,
      certificates: [
        {
          id: 'c1',
          number: 'УД-1',
          issuedAt: new Date('2026-01-10'),
          validUntil: null,
          documentId: null,
          student: { id: 's1', name: 'Иванов Иван' },
          direction: { id: 'd1', name: 'Охрана труда' },
          organization: { id: 'org-1', name: 'ООО Ромашка' },
        },
      ],
      total: 1,
    });
    listOrgStudentTraining.mockResolvedValue([
      {
        id: 'oi1',
        trainingStatus: 'in_progress',
        createdAt: new Date('2026-02-01'),
        direction: { name: 'Пожарная безопасность' },
        order: { id: 'ord1', title: 'Обучение 2026', orderNumber: '42' },
      },
      {
        id: 'oi2',
        trainingStatus: 'certificate_issued',
        createdAt: new Date('2026-03-01'),
        direction: { name: 'Электробезопасность' },
        order: { id: 'ord2', title: 'Без номера', orderNumber: null },
      },
    ]);

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('s1')));

    expect(listCertificates).toHaveBeenCalledWith(expect.anything(), ORG_CTX.session, {
      organizationId: 'org-1',
      studentId: 's1',
    });
    expect(container.textContent).toContain('Иванов Иван');
    expect(container.textContent).toContain('EXT-9');
    expect(container.textContent).toContain('УД-1');
    expect(container.textContent).toContain('Обучается');
    expect(container.textContent).toContain('Удостоверение выдано');
    // Заказ с номером — «№ 42», без номера — title.
    expect(container.textContent).toContain('№ 42');
    expect(container.textContent).toContain('Без номера');
    expect(container.querySelector('a[href="/organization/orders/ord1"]')).not.toBeNull();
  });

  it('пустая история обучения → EmptyState', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue({ ...STUDENT, externalStudentId: null });

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('s1')));

    expect(container.textContent).toContain('Обучение сотрудника пока не оформлялось');
    expect(container.textContent).not.toContain('EXT-9');
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): должность сотрудника в карточке ──────────────────

vi.mock('@/components/organization/student-position-form', () => ({
  StudentPositionForm: (props: {
    organizationId: string;
    studentId: string;
    initialPosition: string | null;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'position-form' },
      `${props.organizationId}|${props.studentId}|${props.initialPosition ?? 'null'}`
    ),
}));

describe('Карточка сотрудника в «Моей организации» — должность', () => {
  it('форма получает скоуп организации и текущее значение', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue({ ...STUDENT, position: 'Инженер' });

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('s1')));
    expect(container.querySelector('[data-testid="position-form"]')!.textContent).toBe(
      'org-1|s1|Инженер'
    );
  });

  it('незаполненная должность приходит как null', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue({ ...STUDENT, position: null });

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('s1')));
    expect(container.querySelector('[data-testid="position-form"]')!.textContent).toContain('null');
  });

  // ── У-30 (этап 5): реквизиты справочника на карточке ─────────────────────
  it('У-30: показывает СНИЛС, дату рождения, телефон и заметку', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue({
      ...STUDENT,
      snils: '112-233-445 95',
      birthDate: new Date('1990-02-01'),
      phone: '+7 900 000-00-00',
      note: 'цех №3',
    });

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('st-1')));

    expect(container.textContent).toContain('112-233-445 95');
    expect(container.textContent).toContain('+7 900 000-00-00');
    expect(container.textContent).toContain('цех №3');
  });

  it('§15: незаполненные реквизиты показываются прочерком, а не пропадают', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getOrgStudent.mockResolvedValue({
      ...STUDENT,
      email: null,
      snils: null,
      birthDate: null,
      phone: null,
      note: null,
    });

    const { container } = await renderServerComponent(OrganizationCompanyStudentPage(props('st-1')));

    expect(container.textContent).toContain('Почта не указана');
    expect(container.textContent).toContain('СНИЛС');
    expect(container.textContent).toContain('—');
  });
});
