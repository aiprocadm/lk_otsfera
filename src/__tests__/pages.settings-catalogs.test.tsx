// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Восемь страниц справочников хаба настроек — четыре пары «администратор ↔
 * руководитель» (`У-127`, `У-128`, `У-130`, `У-208`).
 *
 * Проверяется ровно то, ради чего страницы существуют отдельно от экранов:
 * **каждая сама спрашивает право своего раздела** и **область данных берёт из
 * сессии, а не из адреса**. Экран у пары общий (решение `Р-23`), поэтому
 * перепутать кабинет здесь — значит показать руководителю платформенные
 * настройки.
 */
const mocks = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  listRoutingRules: vi.fn(),
  listTemplates: vi.fn(),
  listReplyTemplates: vi.fn(),
  listCompaniesSla: vi.fn(),
  getSchedulePatterns: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({
  requireSettingsSection: mocks.requireSettingsSection,
}));
vi.mock('@/lib/notifications/routing', () => ({ listRoutingRules: mocks.listRoutingRules }));
vi.mock('@/lib/email/templateOverrides', () => ({ listTemplates: mocks.listTemplates }));
vi.mock('@/lib/services/replyTemplates/crud', () => ({
  listReplyTemplates: mocks.listReplyTemplates,
  REPLY_TEMPLATE_TOKENS: [{ token: 'contact.name', label: 'Имя контакта' }],
}));
vi.mock('@/lib/services/manager/slaSettings', () => ({
  listCompaniesSla: mocks.listCompaniesSla,
}));
vi.mock('@/lib/services/admin/syncSchedules', () => ({
  getSchedulePatterns: mocks.getSchedulePatterns,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import AdminNotificationRulesPage from '@/app/admin/settings/catalogs/notification-rules/page';
import LeaderNotificationRulesPage from '@/app/leader/settings/catalogs/notification-rules/page';
import AdminEmailTemplatesPage from '@/app/admin/settings/catalogs/email-templates/page';
import LeaderEmailTemplatesPage from '@/app/leader/settings/catalogs/email-templates/page';
import AdminReplyTemplatesPage from '@/app/admin/settings/catalogs/reply-templates/page';
import LeaderReplyTemplatesPage from '@/app/leader/settings/catalogs/reply-templates/page';
import AdminSlaIntakePage from '@/app/admin/settings/catalogs/sla-intake/page';
import LeaderSlaIntakePage from '@/app/leader/settings/catalogs/sla-intake/page';

const SESSION = { sub: 'u1', role: 'leader', email: 'l@x.ru', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSettingsSection.mockResolvedValue(SESSION);
  mocks.listRoutingRules.mockResolvedValue([]);
  mocks.listTemplates.mockResolvedValue([]);
  mocks.listReplyTemplates.mockResolvedValue([]);
  mocks.listCompaniesSla.mockResolvedValue({ ok: true, companies: [] });
  mocks.getSchedulePatterns.mockResolvedValue(
    new Map([['monitoring.slaEscalation.cron', '0 * * * *']])
  );
});

describe('Правила уведомлений — пара страниц', () => {
  it('администратор спрашивает своё право и читает платформенный уровень', async () => {
    await renderServerComponent(AdminNotificationRulesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith(
      'catalogs.notificationRules',
      'admin'
    );
    expect(mocks.listRoutingRules).toHaveBeenCalledWith({}, null);
    expect(screen.getByText(/действуют на всей платформе/)).toBeTruthy();
  });

  it('руководитель читает правила своей компании — из сессии, не из адреса', async () => {
    await renderServerComponent(LeaderNotificationRulesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith(
      'catalogs.notificationRules',
      'leader'
    );
    expect(mocks.listRoutingRules).toHaveBeenCalledWith({}, 'c1');
    expect(screen.getByText(/Ваши правила важнее общих/)).toBeTruthy();
  });

  it('руководитель без компании видит объяснение, а не чужие правила', async () => {
    mocks.requireSettingsSection.mockResolvedValue({ ...SESSION, companyId: null });

    await renderServerComponent(LeaderNotificationRulesPage());

    expect(mocks.listRoutingRules).toHaveBeenCalledWith({}, null);
    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
  });
});

describe('Тексты писем — пара страниц', () => {
  it('администратор правит платформенные тексты', async () => {
    await renderServerComponent(AdminEmailTemplatesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('catalogs.emailTemplates', 'admin');
    expect(mocks.listTemplates).toHaveBeenCalledWith({}, null);
    expect(screen.getByText(/действуют на всей платформе/)).toBeTruthy();
  });

  it('руководитель правит тексты своей компании', async () => {
    await renderServerComponent(LeaderEmailTemplatesPage());

    expect(mocks.listTemplates).toHaveBeenCalledWith({}, 'c1');
    expect(screen.getByText(/для писем вашей компании/)).toBeTruthy();
  });

  it('руководитель без компании получает объяснение', async () => {
    mocks.requireSettingsSection.mockResolvedValue({ ...SESSION, companyId: null });

    await renderServerComponent(LeaderEmailTemplatesPage());

    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
  });
});

describe('Шаблоны ответов — пара страниц', () => {
  it('администратор получает свой кабинет и подсказки подстановок', async () => {
    await renderServerComponent(AdminReplyTemplatesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('catalogs.replyTemplates', 'admin');
    expect(mocks.listReplyTemplates).toHaveBeenCalledWith({}, SESSION);
    expect(screen.getByText('Шаблонов пока нет')).toBeTruthy();
  });

  it('руководитель — зеркало того же раздела', async () => {
    await renderServerComponent(LeaderReplyTemplatesPage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('catalogs.replyTemplates', 'leader');
    // Название встречается и в крошках, и в заголовке — это и есть правило
    // зеркала: одно слово во всех местах.
    expect(screen.getAllByText('Шаблоны ответов').length).toBeGreaterThan(1);
  });
});

describe('SLA входящих в работу — пара страниц', () => {
  it('администратор видит все компании и расписание задачи', async () => {
    mocks.listCompaniesSla.mockResolvedValue({
      ok: true,
      companies: [
        {
          id: 'c1',
          name: 'ООО «Первая»',
          slaResponseHours: 8,
          slaWarningHours: 4,
          taskOverdueEscalationDays: 3,
        },
      ],
    });

    await renderServerComponent(AdminSlaIntakePage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('catalogs.slaIntake', 'admin');
    expect(screen.getByText('ООО «Первая»')).toBeTruthy();
    expect(screen.getByRole('button', { name: /0 \* \* \* \*/ })).toBeTruthy();
  });

  it('сбой чтения расписаний не роняет страницу — раздел открывается без него', async () => {
    mocks.getSchedulePatterns.mockRejectedValue(new Error('база недоступна'));

    await renderServerComponent(AdminSlaIntakePage());

    expect(screen.getByText('Компаний пока нет')).toBeTruthy();
  });

  it('отказ сервиса показывается пустым списком, а не падением', async () => {
    mocks.listCompaniesSla.mockResolvedValue({ ok: false, error: 'forbidden' });

    await renderServerComponent(AdminSlaIntakePage());

    expect(screen.getByText('Компаний пока нет')).toBeTruthy();
  });

  it('руководитель видит свою компанию и не видит платформенного расписания', async () => {
    mocks.listCompaniesSla.mockResolvedValue({
      ok: true,
      companies: [
        {
          id: 'c1',
          name: 'ООО «Первая»',
          slaResponseHours: 8,
          slaWarningHours: 4,
          taskOverdueEscalationDays: 3,
        },
      ],
    });

    await renderServerComponent(LeaderSlaIntakePage());

    expect(mocks.requireSettingsSection).toHaveBeenCalledWith('catalogs.slaIntake', 'leader');
    expect(mocks.getSchedulePatterns).not.toHaveBeenCalled();
    expect(screen.queryByText('Как часто проверять')).toBeNull();
  });

  it('руководитель без компании видит объяснение', async () => {
    mocks.requireSettingsSection.mockResolvedValue({ ...SESSION, companyId: null });
    mocks.listCompaniesSla.mockResolvedValue({ ok: false, error: 'company_required' });

    await renderServerComponent(LeaderSlaIntakePage());

    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
  });
});
