// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPiiAccess, listPiiAccessFilters } = vi.hoisted(() => ({
  listPiiAccess: vi.fn(),
  listPiiAccessFilters: vi.fn()
}));
vi.mock('@/lib/services/admin/piiAccess', () => ({ listPiiAccess, listPiiAccessFilters }));

import AdminPiiAccessPage from '@/app/admin/pii-access/page';

const ROW = {
  id: 'ev1',
  createdAt: new Date('2026-07-11T10:00:00Z'),
  actor: { id: 'u1', email: 'e@x.ru', name: 'Емп' },
  userRole: 'manager',
  context: 'manager_students_list',
  labelRu: 'Список слушателей',
  action: 'list',
  subjectType: 'student',
  subjectCount: 1,
  subjects: [{ id: 's1', label: 'Иван И.' }],
  meta: null
};

beforeEach(() => {
  vi.clearAllMocks(); // hoisted-моки живут на весь файл — чистим call-историю (как в pages.admin-audit)
  requireAdmin.mockResolvedValue({ sub: 'adm', role: 'admin' });
  listPiiAccess.mockResolvedValue({ ok: true, rows: [ROW], nextCursor: null });
  listPiiAccessFilters.mockResolvedValue({ ok: true, contexts: [], subjectTypes: [], actors: [] });
  delete process.env.FEATURE_PII_ACCESS_LOG; // opt-out: журнал «включён»
});

afterEach(() => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
});

describe('AdminPiiAccessPage', () => {
  it('рендерит журнал без баннера при включённой записи', async () => {
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toContain('Доступ к ПДн');
    expect(container.textContent).toContain('Иван И.');
    expect(container.textContent).not.toContain('Запись журнала приостановлена');
  });

  it('флаг выключен → баннер паузы, история видна', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toContain('Запись журнала приостановлена');
    expect(container.textContent).toContain('Иван И.');
  });

  it('nextCursor → ссылка следующей страницы; forbidden-ветка → пустая таблица', async () => {
    listPiiAccess.mockResolvedValue({ ok: true, rows: [ROW], nextCursor: 'ev0' });
    const { container } = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({ subjectId: ' s1 ' }) })
    );
    expect(container.textContent).toContain('Следующая страница');
    expect(listPiiAccess.mock.calls[0][2]).toMatchObject({ subjectId: 's1' });

    listPiiAccess.mockResolvedValue({ ok: false, error: 'forbidden' });
    listPiiAccessFilters.mockResolvedValue({ ok: false, error: 'forbidden' });
    const second = await renderServerComponent(
      AdminPiiAccessPage({ searchParams: Promise.resolve({ from: 'not-a-date' }) })
    );
    expect(second.container.textContent).toContain('Записей журнала не найдено');
  });

  it('прокидывает все фильтры из searchParams, валидные даты парсятся', async () => {
    await renderServerComponent(
      AdminPiiAccessPage({
        searchParams: Promise.resolve({
          actorUserId: 'u1',
          userRole: 'leader',
          context: 'calls_list',
          subjectType: 'caller',
          subjectId: 'c1',
          from: '2026-07-01',
          to: '2026-07-11',
          cursor: 'ev5'
        })
      })
    );
    expect(listPiiAccess.mock.calls[0][2]).toMatchObject({
      actorUserId: 'u1',
      userRole: 'leader',
      context: 'calls_list',
      subjectType: 'caller',
      subjectId: 'c1',
      cursor: 'ev5',
      from: new Date('2026-07-01'),
      to: new Date('2026-07-11'),
      take: 50
    });
  });
});
