import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { readSource } from './helpers/source';
import { leadCompanyWhere } from '@/lib/auth/leadScope';
import { kpiMetric } from '@/lib/kpi/metrics';

/**
 * СТРАЖ `Р-Э7-2` (этап 7): лид чужой компании не попадает ни в воронку, ни в
 * показатели, ни в отчёты.
 *
 * До этапа 7 граница компании у лида выглядела так:
 * `OR: [{ assignedManagerId: null }, { assignedManager: { companyId } }]` —
 * то есть **лид без ответственного попадал в выборку КАЖДОЙ компании**. Пока
 * это была одна воронка руководителя, цена ошибки была невелика; метрики и
 * отчёты этапа встали бы на то же правило, и в выгрузку компании поехали бы
 * чужие лиды.
 *
 * Мутация (проверено): вернуть `{ assignedManagerId: null }` в `leadCompanyWhere`
 * → «граница компании» краснеет; убрать `leadCompanyWhere` из метрики лидов
 * → «показатель спрашивает границу» краснеет.
 */
const SRC = join(process.cwd(), 'src');
const ANALYTICS = readSource(join(SRC, 'lib/services/leader/analytics.ts'));

describe('страж: лид чужой компании не считается своим (Р-Э7-2)', () => {
  it('граница компании — ответственный ИЛИ организация, и ничего больше', () => {
    const where = leadCompanyWhere('c1');
    expect(where).toEqual({
      OR: [{ assignedManager: { companyId: 'c1' } }, { organization: { companyId: 'c1' } }],
    });
    // Прежнее правило пускало неназначенные лиды всех компаний сразу.
    expect(JSON.stringify(where)).not.toContain('assignedManagerId');
  });

  it('показатель «лиды заведены» спрашивает границу, а не считает всё подряд', async () => {
    const groupBy = vi.fn(async () => []);
    const prisma = { lead: { groupBy } } as unknown as PrismaClient;
    await kpiMetric('leads_created').compute(prisma, {
      companyId: 'c1',
      from: new Date('2026-09-01'),
      to: new Date('2026-10-01'),
    });
    const where = (groupBy.mock.calls as unknown as Array<[{ where: { OR?: unknown } }]>)[0]![0]
      .where;
    expect(where.OR, 'показатель считает лиды без границы компании').toEqual(
      leadCompanyWhere('c1').OR
    );
  });

  it('воронка руководителя пользуется тем же помощником, а не своим списком', () => {
    // Страж по исходнику: два правила на одну сущность разъезжаются молча —
    // сначала чинят одно место, потом удивляются другому.
    expect(ANALYTICS).toContain('leadCompanyWhere(companyId)');
    expect(ANALYTICS, 'в воронку вернулось прежнее правило').not.toContain(
      'assignedManagerId: null'
    );
  });
});
