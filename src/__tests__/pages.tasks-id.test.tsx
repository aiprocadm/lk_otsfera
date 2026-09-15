// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Страницы карточки задачи (`У-218`, этап 4 PR-1) — менеджер и руководитель.
 *
 * Один файл на два кабинета намеренно: экраны зеркальные (§0.2), и проверять
 * их по отдельности значило бы однажды поправить один и забыть второй.
 *
 * Проверяется ровно то, что делает страница: флаг, гард роли, отказ по чужой
 * задаче и передача кабинета в общий экран (от него зависят ссылки и крошки).
 */

const { requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTaskDetail } = vi.hoisted(() => ({ getTaskDetail: vi.fn() }));
vi.mock('@/lib/services/tasks/detail', () => ({ getTaskDetail }));

const { screenSpy } = vi.hoisted(() => ({ screenSpy: vi.fn() }));
vi.mock('@/components/tasks/task-page-screen', () => ({
  TaskPageScreen: (props: { task: { id: string }; cabinet: string }) => {
    screenSpy(props);
    return React.createElement('div', null, `КАРТОЧКА:${props.task.id}:${props.cabinet}`);
  },
}));

import ManagerTaskPage from '@/app/manager/tasks/[id]/page';
import LeaderTaskPage from '@/app/leader/tasks/[id]/page';

const SESSION = { sub: 'u1', role: 'manager', companyId: 'co-1' };
const TASK = { id: 't1', title: 'Проверить документы' };

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireManager.mockResolvedValue(SESSION);
  requireManagerLeader.mockResolvedValue({ ...SESSION, role: 'leader' });
  getTaskDetail.mockResolvedValue({ ok: true, task: TASK });
});

const CASES = [
  { name: 'менеджер', Page: ManagerTaskPage, cabinet: 'manager', guard: requireManager },
  { name: 'руководитель', Page: LeaderTaskPage, cabinet: 'leader', guard: requireManagerLeader },
] as const;

describe.each(CASES)('карточка задачи: $name', ({ Page, cabinet, guard }) => {
  const open = (id: string) => Page({ params: Promise.resolve({ id }) });

  it('рисует карточку и передаёт СВОЙ кабинет — от него зависят ссылки и крошки', async () => {
    const { container } = await renderServerComponent(open('t1'));
    expect(container.textContent).toContain(`КАРТОЧКА:t1:${cabinet}`);
    expect(screenSpy.mock.calls[0][0].cabinet).toBe(cabinet);
  });

  it('флаг выключен → 404, задачу даже не спрашиваем', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(open('t1'))).rejects.toThrow('NOTFOUND');
    expect(getTaskDetail).not.toHaveBeenCalled();
  });

  it('гард роли вызывается до выборки', async () => {
    await renderServerComponent(open('t1'));
    expect(guard).toHaveBeenCalled();
  });

  it('чужая или несуществующая задача → 404 (сервис не различает их наружу)', async () => {
    getTaskDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(renderServerComponent(open('чужая'))).rejects.toThrow('NOTFOUND');
  });

  it('сессия без компании → 404, а не пустой экран', async () => {
    getTaskDetail.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(renderServerComponent(open('t1'))).rejects.toThrow('NOTFOUND');
  });
});
