import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrgStudent, listOrgStudentTraining } from '@/lib/services/organization/students';

/**
 * Этап 3 PR-1 (ФТ-6.3): сервисы карточки сотрудника — скоуп по организации
 * (чужой сотрудник = null) и история обучения по позициям заказов организации.
 */

const prisma = {
  student: { findFirst: vi.fn() },
  orderItem: { findMany: vi.fn() }
} as never as import('@prisma/client').PrismaClient;

const mocked = prisma as unknown as {
  student: { findFirst: ReturnType<typeof vi.fn> };
  orderItem: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrgStudent', () => {
  it('ищет строго в пределах организации (id + organizationId)', async () => {
    mocked.student.findFirst.mockResolvedValue({ id: 's1', name: 'И', email: 'i@x.ru', externalStudentId: null, createdAt: new Date() });
    const res = await getOrgStudent(prisma, { organizationId: 'org-1', studentId: 's1' });
    expect(res?.id).toBe('s1');
    expect(mocked.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', organizationId: 'org-1' } })
    );
  });

  it('чужой сотрудник → null (страница отвечает notFound)', async () => {
    mocked.student.findFirst.mockResolvedValue(null);
    expect(await getOrgStudent(prisma, { organizationId: 'org-1', studentId: 'alien' })).toBeNull();
  });
});

describe('listOrgStudentTraining', () => {
  it('позиции заказов только своей организации, свежие сверху', async () => {
    mocked.orderItem.findMany.mockResolvedValue([]);
    await listOrgStudentTraining(prisma, { organizationId: 'org-1', studentId: 's1' });
    expect(mocked.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: 's1', order: { organizationId: 'org-1' } },
        orderBy: { createdAt: 'desc' }
      })
    );
  });
});
