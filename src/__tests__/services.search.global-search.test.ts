/**
 * M6 — unit-тесты глобального поиска (спека 2026-07-18 §3, §7): гейты,
 * валидация q, категории под модульными флагами, маппинг хитов, ПДн-журнал
 * (id слушателей, meta без сырой строки), teamMode-чтение.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { globalSearch, SEARCH_TAKE } from '@/lib/services/search/globalSearch';

const ORIGINAL_ENV = { ...process.env };

const manager = { sub: 'm1', role: 'manager', companyId: 'c1', managedOrgIds: ['org1'] } as unknown as SessionPayload;
const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as unknown as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as unknown as SessionPayload;

type Mocks = {
  prisma: PrismaClient;
  order: ReturnType<typeof vi.fn>;
  organization: ReturnType<typeof vi.fn>;
  lead: ReturnType<typeof vi.fn>;
  task: ReturnType<typeof vi.fn>;
  event: ReturnType<typeof vi.fn>;
  document: ReturnType<typeof vi.fn>;
  student: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  companyFindUnique: ReturnType<typeof vi.fn>;
};

function makePrisma(): Mocks {
  const order = vi.fn().mockResolvedValue([]);
  const organization = vi.fn().mockResolvedValue([]);
  const lead = vi.fn().mockResolvedValue([]);
  const task = vi.fn().mockResolvedValue([]);
  const event = vi.fn().mockResolvedValue([]);
  const document = vi.fn().mockResolvedValue([]);
  const student = vi.fn().mockResolvedValue([]);
  const message = vi.fn().mockResolvedValue([]);
  const companyFindUnique = vi.fn().mockResolvedValue({ managerTeamVisibility: false });
  const prisma = {
    order: { findMany: order },
    organization: { findMany: organization },
    lead: { findMany: lead },
    task: { findMany: task },
    calendarEvent: { findMany: event },
    document: { findMany: document },
    student: { findMany: student },
    staffMessage: { findMany: message },
    company: { findUnique: companyFindUnique }
  } as unknown as PrismaClient;
  return { prisma, order, organization, lead, task, event, document, student, message, companyFindUnique };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.FEATURE_GLOBAL_SEARCH = '1';
  process.env.FEATURE_INTERNAL_TASKS = '1';
  process.env.FEATURE_STAFF_CALENDAR = '1';
  process.env.FEATURE_STAFF_CHAT = '1';
  recordPiiAccess.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('globalSearch — гейты', () => {
  it('флаг global_search выключен → forbidden без запросов', async () => {
    delete process.env.FEATURE_GLOBAL_SEARCH;
    const { prisma, order } = makePrisma();
    expect(await globalSearch(prisma, manager, { q: 'тест' })).toEqual({ ok: false, error: 'forbidden' });
    expect(order).not.toHaveBeenCalled();
  });

  it('клиентская роль → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await globalSearch(prisma, partner, { q: 'тест' })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('staff без companyId → forbidden', async () => {
    const { prisma } = makePrisma();
    const noCompany = { sub: 'm9', role: 'manager', companyId: null } as unknown as SessionPayload;
    expect(await globalSearch(prisma, noCompany, { q: 'тест' })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('globalSearch — валидация q', () => {
  it('короткий/пустой запрос (после trim) → too_short без запросов', async () => {
    const { prisma, order } = makePrisma();
    expect(await globalSearch(prisma, manager, { q: '  я  ' })).toEqual({ ok: false, error: 'too_short' });
    expect(await globalSearch(prisma, manager, { q: '   ' })).toEqual({ ok: false, error: 'too_short' });
    expect(order).not.toHaveBeenCalled();
  });

  it('длинный запрос срезается до 100 символов', async () => {
    const { prisma, order } = makePrisma();
    const long = 'а'.repeat(150);
    const res = await globalSearch(prisma, manager, { q: long });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.query).toHaveLength(100);
    const where = order.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('а'.repeat(100));
    expect(JSON.stringify(where)).not.toContain('а'.repeat(101));
  });
});

describe('globalSearch — teamMode', () => {
  it('manager: тумблер читается один раз из company', async () => {
    const { prisma, companyFindUnique } = makePrisma();
    await globalSearch(prisma, manager, { q: 'тест' });
    expect(companyFindUnique).toHaveBeenCalledTimes(1);
    expect(companyFindUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { managerTeamVisibility: true }
    });
  });

  it('admin: тумблер не читается (Model A)', async () => {
    const { prisma, companyFindUnique } = makePrisma();
    await globalSearch(prisma, admin, { q: 'тест' });
    expect(companyFindUnique).not.toHaveBeenCalled();
  });

  it('teamModeOverride (страница лидера): company-wide без чтения тумблера', async () => {
    const { prisma, companyFindUnique, order } = makePrisma();
    await globalSearch(prisma, manager, { q: 'тест', teamModeOverride: true });
    expect(companyFindUnique).not.toHaveBeenCalled();
    // company-wide: заказы скоупятся только компанией (зеркало leader/orders)
    expect(order.mock.calls[0][0].where.AND[0]).toEqual({ companyId: 'c1' });
  });

  it('teamModeOverride=false ведёт себя как отсутствие флага (читает тумблер)', async () => {
    const { prisma, companyFindUnique } = makePrisma();
    await globalSearch(prisma, manager, { q: 'тест', teamModeOverride: false });
    expect(companyFindUnique).toHaveBeenCalledTimes(1);
  });
});

describe('globalSearch — модульные флаги категорий', () => {
  it('staff_chat/internal_tasks/staff_calendar off → категории не запрашиваются', async () => {
    delete process.env.FEATURE_STAFF_CHAT;
    delete process.env.FEATURE_INTERNAL_TASKS;
    delete process.env.FEATURE_STAFF_CALENDAR;
    const { prisma, task, event, message, order } = makePrisma();
    const res = await globalSearch(prisma, manager, { q: 'тест' });
    expect(res.ok).toBe(true);
    expect(task).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(order).toHaveBeenCalled();
  });
});

describe('globalSearch — маппинг выдачи', () => {
  it('хиты смаппены по категориям; пустые категории опущены; limited при полном лимите', async () => {
    const { prisma, order, organization, lead, student, message } = makePrisma();
    order.mockResolvedValue([
      {
        id: 'o1',
        title: 'Обучение ОТ',
        orderNumber: 'З-42',
        createdAt: new Date('2026-07-01'),
        organization: { name: 'ООО Ромашка' }
      },
      {
        id: 'o2',
        title: 'Без номера',
        orderNumber: null,
        createdAt: new Date('2026-07-02'),
        organization: { name: 'ООО Астра' }
      }
    ]);
    organization.mockResolvedValue([
      { id: 'org1', name: 'ООО Ромашка', inn: '7701234567', createdAt: new Date('2026-06-01') },
      { id: 'org2', name: 'ООО Астра', inn: null, createdAt: new Date('2026-06-02') }
    ]);
    lead.mockResolvedValue(
      Array.from({ length: SEARCH_TAKE }, (_, i) => ({
        id: `l${i}`,
        clientCompanyName: `Клиент ${i}`,
        subject: 'Обучение по охране труда',
        createdAt: new Date('2026-07-03')
      }))
    );
    student.mockResolvedValue([
      {
        id: 's1',
        name: 'Иванов Иван',
        email: 'ivanov@example.com',
        createdAt: new Date('2026-07-04'),
        organization: { name: 'ООО Ромашка' }
      },
      // Слушатель без почты и без названия организации: подписи нет вовсе —
      // на экране не должно появиться висящего разделителя « · ».
      {
        id: 's2',
        name: 'Петров Пётр',
        email: null,
        createdAt: new Date('2026-07-04'),
        organization: { name: '' }
      }
    ]);
    message.mockResolvedValue([
      {
        id: 'msg1',
        body: 'Ответ  по    охране труда ' + 'x'.repeat(200),
        attachmentName: null,
        createdAt: new Date('2026-07-05'),
        author: { name: 'Мария' }
      },
      { id: 'msg2', body: '', attachmentName: 'план.pdf', createdAt: new Date('2026-07-06'), author: { name: 'Пётр' } },
      // Сообщение без текста и без вложения: в выдаче должна остаться пустая
      // строка, а не «undefined» на экране.
      { id: 'msg3', body: '', attachmentName: null, createdAt: new Date('2026-07-07'), author: { name: 'Ольга' } }
    ]);

    const res = await globalSearch(prisma, manager, { q: 'охрана' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.groups.map((g) => g.key)).toEqual(['orders', 'organizations', 'leads', 'students', 'messages']);

    const orders = res.groups.find((g) => g.key === 'orders')!;
    expect(orders.labelRu).toBe('Заказы');
    expect(orders.limited).toBe(false);
    expect(orders.hits[0]).toEqual({
      id: 'o1',
      title: 'Обучение ОТ',
      subtitle: 'З-42 · ООО Ромашка',
      href: '/manager/orders/o1',
      date: new Date('2026-07-01')
    });
    expect(orders.hits[1]!.subtitle).toBe('ООО Астра');

    const orgs = res.groups.find((g) => g.key === 'organizations')!;
    expect(orgs.hits[0]!.subtitle).toBe('ИНН 7701234567');
    expect(orgs.hits[0]!.href).toBe('/manager/organizations/org1');
    expect(orgs.hits[1]!.subtitle).toBeNull();

    const leads = res.groups.find((g) => g.key === 'leads')!;
    expect(leads.limited).toBe(true);
    expect(leads.hits[0]!.href).toBe('/manager/leads/l0');

    const students = res.groups.find((g) => g.key === 'students')!;
    expect(students.hits[0]!.subtitle).toBe('ivanov@example.com · ООО Ромашка');
    expect(students.hits[0]!.href).toBe('/manager/students/s1');
    expect(students.hits[1]!.subtitle).toBeNull();

    const messages = res.groups.find((g) => g.key === 'messages')!;
    expect(messages.hits[0]!.title.length).toBeLessThanOrEqual(120);
    expect(messages.hits[0]!.title.endsWith('…')).toBe(true);
    expect(messages.hits[0]!.title).not.toContain('  '); // сниппет схлопывает пробелы
    expect(messages.hits[0]!.subtitle).toBe('Мария');
    expect(messages.hits[1]!.title).toBe('план.pdf'); // attachment-only сообщение
    expect(messages.hits[1]!.href).toBe('/manager/messages');
    expect(messages.hits[2]!.title).toBe(''); // ни текста, ни вложения — пусто, не undefined
  });

  it('задачи/события/документы: сниппеты и ссылки на разделы', async () => {
    const { prisma, task, event, document } = makePrisma();
    task.mockResolvedValue([
      { id: 't1', title: 'Позвонить', description: null, dueDate: new Date('2026-07-20'), createdAt: new Date('2026-07-01') },
      { id: 't2', title: 'Написать', description: 'Длинное описание задачи', dueDate: null, createdAt: new Date('2026-07-02') }
    ]);
    event.mockResolvedValue([{ id: 'e1', title: 'Созвон', location: 'Zoom', startsAt: new Date('2026-07-21') }]);
    document.mockResolvedValue([
      { id: 'd1', name: 'Акт.pdf', createdAt: new Date('2026-07-05'), order: { title: 'Заказ 1' } },
      { id: 'd2', name: 'Прайс.xlsx', createdAt: new Date('2026-07-06'), order: null }
    ]);

    const res = await globalSearch(prisma, manager, { q: 'тест' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const tasks = res.groups.find((g) => g.key === 'tasks')!;
    expect(tasks.hits[0]).toMatchObject({ subtitle: null, href: '/manager/tasks', date: new Date('2026-07-20') });
    expect(tasks.hits[1]).toMatchObject({ subtitle: 'Длинное описание задачи', date: new Date('2026-07-02') });
    const events = res.groups.find((g) => g.key === 'events')!;
    expect(events.hits[0]).toMatchObject({ subtitle: 'Zoom', href: '/manager/calendar', date: new Date('2026-07-21') });
    const docs = res.groups.find((g) => g.key === 'documents')!;
    expect(docs.hits[0]!.subtitle).toBe('Заказ 1');
    expect(docs.hits[1]!.subtitle).toBeNull();
    expect(docs.hits[0]!.href).toBe('/manager/documents');
  });

  it('ничего не найдено → ok с пустыми группами', async () => {
    const { prisma } = makePrisma();
    const res = await globalSearch(prisma, manager, { q: 'тест' });
    expect(res).toEqual({ ok: true, query: 'тест', groups: [] });
  });
});

describe('globalSearch — ПДн (§25.7)', () => {
  it('слушатели журналируются: id строк, meta без сырой строки запроса', async () => {
    const { prisma, student } = makePrisma();
    student.mockResolvedValue([
      { id: 's1', name: 'Иванов', email: 'i@example.com', createdAt: new Date(), organization: { name: 'О' } }
    ]);
    await globalSearch(prisma, manager, { q: 'иванов' });
    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
    const args = recordPiiAccess.mock.calls[0][1];
    expect(args).toMatchObject({
      session: manager,
      context: 'global_search_students',
      subjectIds: ['s1'],
      meta: { take: SEARCH_TAKE, hasQuery: true }
    });
    expect(JSON.stringify(args.meta)).not.toContain('иванов');
  });

  it('пустая выдача слушателей → вызов с пустым subjectIds (no-op внутри record)', async () => {
    const { prisma } = makePrisma();
    await globalSearch(prisma, manager, { q: 'тест' });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, expect.objectContaining({ subjectIds: [] }));
  });
});
