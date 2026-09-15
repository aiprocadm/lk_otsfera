import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/services/tasks/notify', () => ({ notifyTaskAssigned: vi.fn() }));

import { createTask } from '@/lib/services/tasks/tasks';

/**
 * СТРАЖ `У-220`: КАЖДАЯ привязка задачи проверяется на компанию.
 *
 * Почему страж, а не обычный тест: связей стало семь, и добавляются они по
 * одной. Проверка новой связи — четыре строки, которые легко не написать:
 * ничего не упадёт, экран будет работать, а `id` из формы тихо привяжет задачу
 * к чужому контакту, документу или переписке. Ровно этот класс («механизм есть,
 * но врезан не везде») назывался в прогоне сопровождения №28 «страж видит одну
 * форму нарушения из трёх».
 *
 * Поэтому здесь проверяется не «работает ли одна проверка», а **полнота**:
 * список связей и список проверок — одно и то же множество.
 *
 * Мутация (проверено 15.09.2026): убрать в `validateRefs` проверку
 * `linkedContactId` → соответствующий случай краснеет.
 */

const MY_COMPANY = 'co-1';
const OTHER_COMPANY = 'co-2';

/** Все связи задачи: поле формы → таблица, у которой спрашивают компанию. */
const LINKS = [
  { field: 'linkedOrderId', model: 'order' },
  { field: 'linkedOrganizationId', model: 'organization' },
  { field: 'linkedDealId', model: 'deal' },
  { field: 'linkedContactId', model: 'contact' },
  { field: 'linkedDialogId', model: 'messengerDialog' },
  { field: 'linkedDocumentId', model: 'document' },
] as const;

const manager = { sub: 'u1', role: 'manager', companyId: MY_COMPANY } as SessionPayload;

/** Прайс-фейк: каждая таблица отвечает строкой указанной компании. */
function prismaWith(ownerByModel: Record<string, string | null>): PrismaClient {
  const table = (model: string) => ({
    findUnique: vi.fn().mockResolvedValue(
      model in ownerByModel ? { id: 'x', companyId: ownerByModel[model] } : { id: 'x', companyId: MY_COMPANY }
    ),
  });
  const tx = {
    order: table('order'),
    organization: table('organization'),
    lead: { findUnique: vi.fn().mockResolvedValue({ id: 'l1' }) },
    deal: table('deal'),
    contact: table('contact'),
    messengerDialog: table('messengerDialog'),
    document: table('document'),
    user: { count: vi.fn().mockResolvedValue(0) },
    task: { create: vi.fn().mockResolvedValue({ id: 't1', title: 'T', dueDate: null }) },
    taskAssignee: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    ...tx,
    taskColumn: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
}

beforeEach(() => vi.clearAllMocks());

describe('страж: ни одна привязка задачи не проходит мимо проверки компании', () => {
  it.each(LINKS)('$field чужой компании — задача НЕ создаётся', async ({ field, model }) => {
    const prisma = prismaWith({ [model]: OTHER_COMPANY });
    const res = await createTask(prisma, manager, {
      title: 'Задача',
      [field]: 'чужой-объект',
    } as never);
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it.each(LINKS)('$field своей компании — задача создаётся', async ({ field, model }) => {
    const prisma = prismaWith({ [model]: MY_COMPANY });
    const res = await createTask(prisma, manager, {
      title: 'Задача',
      [field]: 'свой-объект',
    } as never);
    expect(res).toEqual({ ok: true, id: 't1' });
  });

  it.each(LINKS)('$field, которого нет в базе, — отказ', async ({ field, model }) => {
    const prisma = prismaWith({});
    (prisma as unknown as Record<string, { findUnique: ReturnType<typeof vi.fn> }>)[
      model
    ].findUnique.mockResolvedValue(null);
    const res = await createTask(prisma, manager, {
      title: 'Задача',
      [field]: 'нет-такого',
    } as never);
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('НИЧЕЙНЫЙ диалог (общая очередь) задачу заводить разрешает', async () => {
    // `companyId = null` — это сообщение от человека, которого система ещё не
    // узнала. Такие разбирают все; запретить по ним задачу значило бы запретить
    // взять обращение в работу.
    const prisma = prismaWith({ messengerDialog: null });
    const res = await createTask(prisma, manager, {
      title: 'Разобрать обращение',
      linkedDialogId: 'ничей',
    } as never);
    expect(res).toEqual({ ok: true, id: 't1' });
  });

  it('лид проверяется на существование, а не на компанию — он общий (single-tenant)', async () => {
    const prisma = prismaWith({});
    const res = await createTask(prisma, manager, {
      title: 'Задача по лиду',
      linkedLeadId: 'l1',
    } as never);
    expect(res).toEqual({ ok: true, id: 't1' });
  });
});
