// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Пять страниц: поиск администратора (`У-112`), «Сайт» (`У-211`), «Политики
 * входа» (`У-129`) и две вкладки «Обмен с 1С» (`У-113`).
 *
 * Общая мысль: страница сама спрашивает право, сама решает, что показать при
 * отказе, и не притворяется работающей, когда данных нет. Секрет наружу не
 * отдаётся даже на свою страницу — приходит только признак «задан».
 */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireSettingsSection: vi.fn(),
  isFeatureEnabled: vi.fn(),
  globalSearch: vi.fn(),
  getSettingsView: vi.fn(),
  listAssignableStaff: vi.fn(),
  getAppBaseUrl: vi.fn(),
  listExchangeHistory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin: mocks.requireAdmin,
  requireManager: mocks.requireManager,
}));
vi.mock('@/lib/auth/requireSettings', () => ({
  requireSettingsSection: mocks.requireSettingsSection,
}));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('@/lib/services/search/globalSearch', () => ({ globalSearch: mocks.globalSearch }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView: mocks.getSettingsView }));
vi.mock('@/lib/services/messengers/assign', () => ({
  listAssignableStaff: mocks.listAssignableStaff,
}));
vi.mock('@/lib/notifications/shared', () => ({ getAppBaseUrl: mocks.getAppBaseUrl }));
vi.mock('@/lib/services/import/history', () => ({
  listExchangeHistory: mocks.listExchangeHistory,
  // Компонент истории берёт отсюда же названия каналов; без них подмена
  // модуля роняет сборку теста ещё до первой проверки.
  CHANNEL_LABEL: {
    excel: 'Загрузка Excel',
    statement: 'Выписка по счёту 51',
    auto: 'Автообмен',
    documents: 'Документы → 1С',
    debts: 'Дебиторка',
  },
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import AdminSearchPage from '@/app/admin/search/page';
import AdminWebsiteSettingsPage from '@/app/admin/settings/integrations/website/page';
import AdminLoginPoliciesPage from '@/app/admin/settings/security/login-policies/page';
import ManagerExchangePage from '@/app/manager/exchange/page';
import ManagerExchangeHistoryPage from '@/app/manager/exchange/history/page';

const SESSION = { sub: 'u1', role: 'admin', email: 'a@x.ru', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(SESSION);
  mocks.requireManager.mockResolvedValue({ ...SESSION, role: 'manager' });
  mocks.requireSettingsSection.mockResolvedValue(SESSION);
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.globalSearch.mockResolvedValue({ ok: true, groups: [], query: 'акт' });
  mocks.getSettingsView.mockResolvedValue([]);
  mocks.listAssignableStaff.mockResolvedValue([]);
  mocks.getAppBaseUrl.mockReturnValue('https://lk.otsfera.ru');
  mocks.listExchangeHistory.mockResolvedValue({ ok: true, items: [] });
});

describe('Поиск администратора', () => {
  it('выключённый рычаг закрывает раздел', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await expect(
      renderServerComponent(AdminSearchPage({ searchParams: Promise.resolve({}) }))
    ).rejects.toThrow('NOTFOUND');
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('пустой запрос не зовёт поиск и ничего не обещает', async () => {
    await renderServerComponent(AdminSearchPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.globalSearch).not.toHaveBeenCalled();
    expect(screen.queryByText('Введите минимум 2 символа.')).toBeNull();
  });

  it('один символ — просим дописать, а не ищем', async () => {
    await renderServerComponent(AdminSearchPage({ searchParams: Promise.resolve({ q: 'а' }) }));

    expect(mocks.globalSearch).not.toHaveBeenCalled();
    expect(screen.getByText('Введите минимум 2 символа.')).toBeTruthy();
  });

  it('запрос из двух символов уходит в поиск с обрезанными пробелами', async () => {
    await renderServerComponent(
      AdminSearchPage({ searchParams: Promise.resolve({ q: '  акт  ' }) })
    );

    expect(mocks.globalSearch).toHaveBeenCalledWith({}, SESSION, { q: 'акт' });
  });

  it('сервис тоже может сказать «коротко» — экран это понимает', async () => {
    mocks.globalSearch.mockResolvedValue({ ok: false, error: 'too_short' });

    await renderServerComponent(AdminSearchPage({ searchParams: Promise.resolve({ q: 'ак' }) }));

    expect(screen.getByText('Введите минимум 2 символа.')).toBeTruthy();
  });

  it('прочий отказ сервиса — честное «поиск недоступен»', async () => {
    mocks.globalSearch.mockResolvedValue({ ok: false, error: 'forbidden' });

    await renderServerComponent(AdminSearchPage({ searchParams: Promise.resolve({ q: 'акт' }) }));

    expect(screen.getByText('Поиск недоступен.')).toBeTruthy();
  });
});

describe('Настройки сайта', () => {
  it('токен наружу не отдаётся — приходит только признак «задан»', async () => {
    mocks.getSettingsView.mockResolvedValue([
      { key: 'site.enabled', value: 'TRUE', isSet: true },
      { key: 'site.formToken', value: '', isSet: true },
      { key: 'site.allowedOrigins', value: 'https://otsfera.ru', isSet: true },
      { key: 'site.defaultManagerId', value: 'm1', isSet: true },
    ]);
    mocks.listAssignableStaff.mockResolvedValue([{ id: 'm1', name: 'Иванов' }]);

    await renderServerComponent(AdminWebsiteSettingsPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('integrations.website', 'admin');
    expect(screen.getByText('Задан')).toBeTruthy();
    expect(screen.getByText('Иванов')).toBeTruthy();
  });

  it('ничего не настроено — приём выключен, токена нет', async () => {
    await renderServerComponent(AdminWebsiteSettingsPage());

    expect(screen.getByText('Не задан')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выпустить токен' })).toBeTruthy();
  });
});

describe('Политики входа', () => {
  it('значения подставляются в поля, границы видны рядом', async () => {
    // Ключ настоящий — иначе ветка «значение нашлось» не проходится.
    mocks.getSettingsView.mockResolvedValue([
      { key: 'login.twoFactorCodeTtlMinutes', value: '10', isSet: true },
    ]);

    await renderServerComponent(AdminLoginPoliciesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('security.loginPolicies', 'admin');
    expect(screen.getByText('Политики входа')).toBeTruthy();
    expect(screen.getAllByText(/допустимо от/).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('10')).toBeTruthy();
  });

  it('база недоступна — раздел открывается пустым, а не падает', async () => {
    mocks.getSettingsView.mockRejectedValue(new Error('база недоступна'));

    await renderServerComponent(AdminLoginPoliciesPage());

    expect(screen.getByText('Политики входа')).toBeTruthy();
  });
});

describe('Обмен с 1С', () => {
  it('корень раздела уводит на первую вкладку', async () => {
    await expect(renderServerComponent(ManagerExchangePage())).rejects.toThrow(
      'REDIRECT:/manager/exchange/excel'
    );
    expect(mocks.requireManager).toHaveBeenCalled();
  });

  it('история показывает список загрузок', async () => {
    await renderServerComponent(ManagerExchangeHistoryPage());

    expect(screen.getByText('История обмена')).toBeTruthy();
    expect(mocks.listExchangeHistory).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ sub: 'u1' })
    );
  });

  it('прав не хватило — экран говорит об этом, а не показывает пустоту', async () => {
    mocks.listExchangeHistory.mockResolvedValue({ ok: false, error: 'forbidden' });

    await renderServerComponent(ManagerExchangeHistoryPage());

    expect(screen.getByRole('alert').textContent).toContain('Недостаточно прав');
  });
});
