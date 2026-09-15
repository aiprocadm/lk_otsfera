// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessengersPage from '@/app/manager/messengers/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Написать первым» с карточки организации (`У-216`, этап 3 PR-6).
 *
 * Человек нажал кнопку на вкладке «Диалоги» и попал на экран «Мессенджеры» с
 * `?newOrg=<id>`. Ожидание у него простое: окно уже открыто, а в списке —
 * люди ИМЕННО этой организации. Проверяем оба обещания:
 *  · список сужён — сервис зовётся с `{ organizationId }` (а не фильтруется
 *    на клиенте: тогда в справочнике на тысячу контактов человек искал бы
 *    своих глазами);
 *  · окно открыто сразу — раньше признаком служил только `?new=`, и приход с
 *    карточки организации упирался в закрытую форму.
 */

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDialogs, listDialogCandidates } = vi.hoisted(() => ({
  listDialogs: vi.fn(),
  listDialogCandidates: vi.fn(),
}));
vi.mock('@/lib/services/messengers/list', () => ({ listDialogs }));
vi.mock('@/lib/services/messengers/start', () => ({ listDialogCandidates }));

vi.mock('@/components/manager/messengers/dialog-list', () => ({
  DialogList: () => null,
}));

// Зеркало пропсов кнопки: сама модалка проверена в
// `components.new-dialog-reasons`, здесь важно, с чем её собрала страница.
vi.mock('@/components/manager/messengers/new-dialog-button', () => ({
  NewDialogButton: (props: { candidates: unknown[]; preselect?: string; autoOpen?: boolean }) =>
    React.createElement('button', {
      'data-testid': 'new-dialog',
      'data-preselect': props.preselect ?? 'нет',
      'data-auto-open': String(Boolean(props.autoOpen)),
      'data-candidates': props.candidates.length,
    }),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

/** Кнопка стоит в двух местах (шапка и пустое состояние) — берём любую. */
async function renderPage(sp: Record<string, string>) {
  const { container } = await renderServerComponent(
    ManagerMessengersPage({ searchParams: Promise.resolve(sp) })
  );
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireManager.mockResolvedValue(SESSION);
  listDialogs.mockResolvedValue({ items: [], total: 0 });
  listDialogCandidates.mockResolvedValue([]);
});

describe('ManagerMessengersPage — ?newOrg=<id> (У-216)', () => {
  it('сужает список кандидатов до одной организации', async () => {
    await renderPage({ newOrg: 'org-1' });
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, { organizationId: 'org-1' });
  });

  it('и сразу открывает окно «Новый диалог»', async () => {
    const container = await renderPage({ newOrg: 'org-1' });
    const buttons = [...container.querySelectorAll('[data-testid="new-dialog"]')];
    // Кнопок две — в шапке и в пустом состоянии; окно обязано открыться у обеих.
    expect(buttons.map((b) => b.getAttribute('data-auto-open'))).toEqual(['true', 'true']);
    // Человек не выбран: с карточки организации мы знаем только организацию.
    expect(buttons.map((b) => b.getAttribute('data-preselect'))).toEqual(['нет', 'нет']);
  });

  it('`newOrg` — не фильтр списка диалогов: сам список остаётся полным', async () => {
    await renderPage({ newOrg: 'org-1' });
    expect(listDialogs).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
  });

  it('пустой `newOrg` сужением не считается — список общий и окно закрыто', async () => {
    const container = await renderPage({ newOrg: '' });
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, {});
    expect(
      container.querySelector('[data-testid="new-dialog"]')?.getAttribute('data-auto-open')
    ).toBe('false');
  });

  it('без параметров кандидаты общие, окно закрыто', async () => {
    const container = await renderPage({});
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, {});
    expect(
      container.querySelector('[data-testid="new-dialog"]')?.getAttribute('data-auto-open')
    ).toBe('false');
  });

  it('`?new=<contactId>` тоже открывает окно — и человек уже выбран (У-179)', async () => {
    const container = await renderPage({ new: 'ct-1' });
    const button = container.querySelector('[data-testid="new-dialog"]');
    expect(button?.getAttribute('data-auto-open')).toBe('true');
    expect(button?.getAttribute('data-preselect')).toBe('ct-1');
    // Приход из карточки контакта список не сужает: сужает только организация.
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, {});
  });

  it('оба параметра сразу: и сужение по организации, и предвыбранный человек', async () => {
    const container = await renderPage({ new: 'ct-1', newOrg: 'org-1' });
    const button = container.querySelector('[data-testid="new-dialog"]');
    expect(listDialogCandidates).toHaveBeenCalledWith({}, SESSION, { organizationId: 'org-1' });
    expect(button?.getAttribute('data-preselect')).toBe('ct-1');
    expect(button?.getAttribute('data-auto-open')).toBe('true');
  });
});
