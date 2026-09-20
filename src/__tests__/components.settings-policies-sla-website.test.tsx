// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Четыре экрана хаба настроек: политики входа (`У-129`), SLA входящих в
 * работу (`У-130`), шаблоны ответов (`У-208`) и приём заявок с сайта
 * (`У-211`).
 *
 * У всех четырёх общая мысль: настройка, которая раньше жила на сервере или в
 * чужом разделе, переехала на экран — и экран обязан честно предупреждать о
 * последствиях. Поэтому здесь проверяются подтверждения, пометки «показано
 * один раз» и пустые состояния с кнопкой (`У-74`).
 */
const actions = vi.hoisted(() => ({
  saveReplyTemplateAction: vi.fn(),
  deleteReplyTemplateAction: vi.fn(),
  issueSiteTokenAction: vi.fn(),
  saveWebsiteSettingsAction: vi.fn(),
  saveSchedulePatternAction: vi.fn(),
  saveSlaSettingsAction: vi.fn(),
}));
vi.mock('@/server-actions/replyTemplates', () => ({
  saveReplyTemplateAction: actions.saveReplyTemplateAction,
  deleteReplyTemplateAction: actions.deleteReplyTemplateAction,
}));
vi.mock('@/server-actions/admin/website', () => ({
  issueSiteTokenAction: actions.issueSiteTokenAction,
  saveWebsiteSettingsAction: actions.saveWebsiteSettingsAction,
}));
vi.mock('@/server-actions/admin/syncControl', () => ({
  saveSchedulePatternAction: actions.saveSchedulePatternAction,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

import { LoginPoliciesForm } from '@/components/settings/login-policies-form';
import { SlaIntakeScreen } from '@/components/settings/sla-intake-screen';
import { ReplyTemplatesScreen } from '@/components/settings/reply-templates-screen';
import { WebsiteFormSettings } from '@/components/settings/website-form-settings';

beforeEach(() => {
  vi.clearAllMocks();
  // Результат действия — это `{ ok: true } & T`, а не `{ ok, data }`:
  // поля данных лежат рядом с флагом, не во вложенном объекте.
  actions.saveReplyTemplateAction.mockResolvedValue({ ok: true, id: 't1' });
  actions.deleteReplyTemplateAction.mockResolvedValue({ ok: true });
  actions.issueSiteTokenAction.mockResolvedValue({ ok: true, token: 'секрет-1' });
  actions.saveWebsiteSettingsAction.mockResolvedValue({ ok: true });
  actions.saveSchedulePatternAction.mockResolvedValue({ ok: true });
});

describe('LoginPoliciesForm — политики входа', () => {
  const fields = [
    { field: 'login.codeTtl', label: 'Срок жизни кода, секунд', hint: '300', min: 60, max: 900 },
    { field: 'login.attempts', label: 'Попыток ввода', hint: '5', min: 1, max: 10 },
  ];

  it('границы допустимых значений написаны рядом с полем', () => {
    render(<LoginPoliciesForm fields={fields} values={{}} action={vi.fn()} />);

    expect(screen.getByText('допустимо от 60 до 900')).toBeTruthy();
    expect(screen.getByText(/Пустое поле означает «взять значение сервера/)).toBeTruthy();
  });

  it('подтверждение спрашивается всегда — ошибка здесь закрывает вход всем', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const confirm = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal('confirm', confirm);

    const { container } = render(
      <LoginPoliciesForm fields={fields} values={{ 'login.attempts': '5' }} action={action} />
    );
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0]?.[0])).toContain('помешать войти всем сотрудникам');
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toContain('Сохранено');
  });

  it('отказ от подтверждения ничего не сохраняет', async () => {
    const action = vi.fn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );

    const { container } = render(<LoginPoliciesForm fields={fields} values={{}} action={action} />);
    fireEvent.submit(container.querySelector('form')!);

    await new Promise((r) => setTimeout(r, 0));
    expect(action).not.toHaveBeenCalled();
  });

  it('отказ сервера объясняется по-русски', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'value_out_of_range' });

    const { container } = render(<LoginPoliciesForm fields={fields} values={{}} action={action} />);
    fireEvent.submit(container.querySelector('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('вне допустимых границ');
  });
});

describe('SlaIntakeScreen — SLA входящих в работу', () => {
  const company = {
    id: 'c1',
    name: 'ООО «Первая»',
    slaResponseHours: 8,
    slaWarningHours: 4,
    taskOverdueEscalationDays: 3,
  };

  it('руководитель без компании видит объяснение', () => {
    render(
      <SlaIntakeScreen cabinet="leader" hasCompany={false} companies={[]} patterns={new Map()} />
    );

    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
  });

  it('компаний нет — пустой экран с кнопкой, а не «нет данных»', () => {
    render(<SlaIntakeScreen cabinet="admin" hasCompany companies={[]} patterns={new Map()} />);

    expect(screen.getByText('Компаний пока нет')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Перейти к настройкам доступа' })).toBeTruthy();
  });

  it('администратор видит таблицу всех компаний и расписание проверки', () => {
    render(
      <SlaIntakeScreen
        cabinet="admin"
        hasCompany
        companies={[
          company,
          { ...company, id: 'c2', name: 'ООО «Вторая»', taskOverdueEscalationDays: 0 },
        ]}
        patterns={new Map([['monitoring.slaEscalation.cron', '*/10 * * * *']])}
      />
    );

    expect(screen.getByText('ООО «Первая»')).toBeTruthy();
    expect(screen.getByText('ООО «Вторая»')).toBeTruthy();
    // Ноль дней означает «не эскалировать» — печатается прочерком, а не «0».
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Как часто проверять')).toBeTruthy();
    expect(screen.getByRole('button', { name: /\*\/10 \* \* \* \*/ })).toBeTruthy();
  });

  it('расписания нет — показывается прочерк, а умолчание считается действующим', () => {
    render(
      <SlaIntakeScreen cabinet="admin" hasCompany companies={[company]} patterns={new Map()} />
    );

    expect(screen.getByRole('button', { name: /Расписание: —/ })).toBeTruthy();
  });

  it('руководитель видит карточку своей компании, а не таблицу', () => {
    render(
      <SlaIntakeScreen cabinet="leader" hasCompany companies={[company]} patterns={new Map()} />
    );

    expect(screen.queryByText('Как часто проверять')).toBeNull();
    expect(screen.getByText(/эскалировать вам/)).toBeTruthy();
  });
});

describe('ReplyTemplatesScreen — шаблоны ответов', () => {
  const tpl = {
    id: 't1',
    title: 'Счёт отправлен',
    body: 'Здравствуйте!',
    // Пустой список каналов — «предлагать во всех»: шаблон ответа не привязан
    // к одному мессенджеру.
    channels: [],
    isActive: true,
    sortOrder: 0,
    usageCount: 7,
  };
  const tokens = [{ token: 'contact.name', label: 'Имя контакта' }];

  it('шаблонов нет — пустой экран объясняет, что нажать', () => {
    render(<ReplyTemplatesScreen cabinet="admin" rows={[]} tokens={tokens} />);

    expect(screen.getByText('Шаблонов пока нет')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Добавить шаблон' }).length).toBeGreaterThan(0);
  });

  it('список показывает счётчик использования и пометку «не предлагается»', () => {
    render(
      <ReplyTemplatesScreen
        cabinet="leader"
        rows={[tpl, { ...tpl, id: 't2', title: 'Выключенный', isActive: false }]}
        tokens={tokens}
      />
    );

    // Оба шаблона показывают счётчик — берём все, чтобы не спорить о порядке.
    expect(screen.getAllByText('использован 7 раз')).toHaveLength(2);
    expect(screen.getByText('Не предлагается')).toBeTruthy();
  });

  it('«Добавить шаблон» открывает форму с подсказкой подстановок', () => {
    render(<ReplyTemplatesScreen cabinet="admin" rows={[]} tokens={tokens} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить шаблон' })[0]!);

    expect(screen.getByLabelText('Название шаблона')).toBeTruthy();
    expect(screen.getByText('{{contact.name}}')).toBeTruthy();
  });

  it('новый шаблон уходит без идентификатора, а правка — с ним', async () => {
    const { container } = render(
      <ReplyTemplatesScreen cabinet="admin" rows={[tpl]} tokens={tokens} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Добавить шаблон' }));
    fireEvent.change(screen.getByLabelText('Название шаблона'), { target: { value: 'Новый' } });
    fireEvent.change(screen.getByLabelText('Текст шаблона'), { target: { value: 'Текст' } });
    // Ненулевой порядок: с нулём ветка «|| 0» не различается.
    fireEvent.change(screen.getByLabelText('Порядок в списке'), { target: { value: '5' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(actions.saveReplyTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: null,
          title: 'Новый',
          body: 'Текст',
          isActive: true,
          sortOrder: 5,
        })
      )
    );
    expect(toastMock.success).toHaveBeenCalledWith('Шаблон добавлен');
  });

  it('правка существующего сохраняется под его идентификатором', async () => {
    const { container } = render(
      <ReplyTemplatesScreen cabinet="admin" rows={[tpl]} tokens={tokens} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(actions.saveReplyTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' })
      )
    );
    expect(toastMock.success).toHaveBeenCalledWith('Шаблон сохранён');
  });

  it('«Отмена» закрывает форму правки', () => {
    render(<ReplyTemplatesScreen cabinet="admin" rows={[tpl]} tokens={tokens} />);

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByLabelText('Название шаблона')).toBeNull();
  });

  it('удаление зовёт действие и подтверждает словами', async () => {
    render(<ReplyTemplatesScreen cabinet="admin" rows={[tpl]} tokens={tokens} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(actions.deleteReplyTemplateAction).toHaveBeenCalledWith({ id: 't1' })
    );
    expect(toastMock.success).toHaveBeenCalledWith('Шаблон удалён');
  });

  it('отказ сохранения показывается по-русски', async () => {
    actions.saveReplyTemplateAction.mockResolvedValue({ ok: false, error: 'text_too_long' });
    const { container } = render(
      <ReplyTemplatesScreen cabinet="admin" rows={[]} tokens={tokens} />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить шаблон' })[0]!);
    fireEvent.submit(container.querySelector('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('Слишком длинный текст');
  });

  it('отказ удаления показывается рядом с кнопкой', async () => {
    actions.deleteReplyTemplateAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<ReplyTemplatesScreen cabinet="admin" rows={[tpl]} tokens={tokens} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('возможно, его уже удалили');
  });
});

describe('WebsiteFormSettings — приём заявок с сайта', () => {
  const props = {
    enabled: true,
    allowedOrigins: 'https://otsfera.ru',
    defaultManagerId: '',
    tokenIsSet: false,
    appOrigin: 'https://lk.otsfera.ru',
    managers: [{ id: 'm1', name: 'Иванов' }],
  };

  it('без токена приём не работает — так и помечено, и кнопка зовёт выпустить', () => {
    render(<WebsiteFormSettings {...props} />);

    expect(screen.getByText('Не задан')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выпустить токен' })).toBeTruthy();
    expect(screen.getByText(/Поле-ловушку не удаляйте/)).toBeTruthy();
  });

  it('токен уже есть — кнопка предупреждает, что прежний отзовётся', () => {
    render(<WebsiteFormSettings {...props} tokenIsSet />);

    expect(screen.getByText('Задан')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выпустить новый токен' })).toBeTruthy();
    expect(screen.getByText(/Новый выпуск отзывает прежний/)).toBeTruthy();
  });

  it('выпущенный токен показывается один раз и сразу попадает в готовый код', async () => {
    render(<WebsiteFormSettings {...props} />);

    // До выпуска в коде стоит заглушка, а не пустое место (она упомянута и в
    // пояснении, и в самом коде формы).
    expect(screen.getAllByText(/ВАШ_ТОКЕН/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Выпустить токен' }));

    await waitFor(() => expect(screen.getByText(/больше он не покажется/)).toBeTruthy());
    expect(screen.getByText('секрет-1')).toBeTruthy();
    expect(toastMock.success).toHaveBeenCalledWith('Токен выпущен — скопируйте его сейчас');
  });

  it('отказ выпуска объясняется причиной', async () => {
    actions.issueSiteTokenAction.mockResolvedValue({ ok: false, error: 'save_failed' });
    render(<WebsiteFormSettings {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Выпустить токен' }));

    expect((await screen.findByRole('alert')).textContent).toContain('ключ шифрования');
  });

  it('настройки сохраняются тем, что стоит в форме', async () => {
    render(<WebsiteFormSettings {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(actions.saveWebsiteSettingsAction).toHaveBeenCalledWith({
        enabled: true,
        allowedOrigins: 'https://otsfera.ru',
        defaultManagerId: '',
      })
    );
    expect(toastMock.success).toHaveBeenCalledWith('Настройки сохранены');
  });

  it('слишком много доменов — понятный отказ', async () => {
    actions.saveWebsiteSettingsAction.mockResolvedValue({ ok: false, error: 'too_many_origins' });
    render(<WebsiteFormSettings {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('не больше пяти');
  });

  it('«Всем менеджерам» — выбор по умолчанию, список сотрудников рядом', () => {
    render(<WebsiteFormSettings {...props} />);

    expect(screen.getByText('Всем менеджерам')).toBeTruthy();
    expect(screen.getByText('Иванов')).toBeTruthy();
  });
});
