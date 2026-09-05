// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Экран «Обмен с 1С»: вход-навигатор (`У-47`), вкладка «История» (`У-48`) и
 * шлюз со старого адреса «Синхронизации» (`У-46`).
 *
 * Главное, что проверяем помимо разметки — **гард на каждый запрос**: скрытая
 * карточка это внешний вид, а не защита (CLAUDE.md §2b).
 */
const { requireSettingsSection } = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(async () => ({ sub: 'u1', role: 'admin' })),
}));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { listExchangeHistory } = vi.hoisted(() => ({ listExchangeHistory: vi.fn() }));
vi.mock('@/lib/services/import/history', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listExchangeHistory,
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
// `useRouter` — из-за кнопки отката в общей истории (`У-59`): она обновляет
// список после успешного отката.
vi.mock('next/navigation', () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));

import AdminOneCIndexPage from '@/app/admin/settings/integrations/1c/page';
import AdminOneCHistoryPage from '@/app/admin/settings/integrations/1c/history/page';
import AdminSyncLegacyPage from '@/app/admin/settings/integrations/sync/page';

beforeEach(() => {
  requireSettingsSection.mockClear();
  listExchangeHistory.mockReset();
  redirect.mockClear();
});

describe('вход в «Обмен с 1С» (У-47)', () => {
  it('вместо редиректа на форму показывает навигатор задачи', async () => {
    const { container } = await renderServerComponent(AdminOneCIndexPage());
    expect(container.textContent).toContain('Что вы хотите сделать?');
    expect(container.textContent).toContain('Разнести оплаты из банка');
    // §15: заголовок и подзаголовок в одну строку — «где я / что здесь».
    expect(container.querySelector('h1')?.textContent).toBe('Обмен с 1С');
    expect(container.textContent).toContain('в одном месте');
  });

  it('право проверяется на каждый запрос, а не скрытием карточки', async () => {
    await renderServerComponent(AdminOneCIndexPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', 'admin');
  });
});

describe('вкладка «История» (У-48)', () => {
  it('показывает записи, полученные сервисом', async () => {
    listExchangeHistory.mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'i1',
          channel: 'statement',
          createdAt: '2026-08-11T10:00:00.000Z',
          title: 'Выписка.xls',
          authorName: 'Бухгалтер',
          status: 'committed',
          rollback: 'unsupported',
          counts: { imported: 129 },
          detail: null,
        },
      ],
    });
    const { container } = await renderServerComponent(AdminOneCHistoryPage());
    expect(container.querySelector('h1')?.textContent).toBe('История обмена');
    expect(container.textContent).toContain('Выписка.xls');
    expect(container.textContent).toContain('Бухгалтер');
  });

  it('отказ сервиса — понятный русский текст, а не пустая страница', async () => {
    listExchangeHistory.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminOneCHistoryPage());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Недостаточно прав');
  });
});

describe('старый адрес «Синхронизации» (У-46)', () => {
  it('уводит на вкладку «Автообмен», а не отдаёт 404', () => {
    expect(() => AdminSyncLegacyPage()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/settings/integrations/1c/auto');
  });
});
