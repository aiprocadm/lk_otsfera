// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Четыре органа управления интеграциями в кабинете администратора:
 * «использовать значение сервера» (`У-131`), секрет вебхука (`У-123`),
 * расписание обмена (`У-125`) и параметры обмена с 1С (`У-125`).
 *
 * Общий смысл у всех один: то, что раньше правилось только на сервере, теперь
 * правится с экрана — а значит экран обязан честно говорить, что произойдёт.
 * Поэтому здесь проверяется не вёрстка, а обещания: секрет показывается один
 * раз, расписание показывает даты, а включение боевого режима спрашивает
 * подтверждение.
 */
const actions = vi.hoisted(() => ({
  resetSettingToServerValueAction: vi.fn(),
  generateWebhookSecretAction: vi.fn(),
  registerWebhookAction: vi.fn(),
  saveSchedulePatternAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/integrationSettings', () => ({
  resetSettingToServerValueAction: actions.resetSettingToServerValueAction,
  generateWebhookSecretAction: actions.generateWebhookSecretAction,
  registerWebhookAction: actions.registerWebhookAction,
}));
vi.mock('@/server-actions/admin/syncControl', () => ({
  saveSchedulePatternAction: actions.saveSchedulePatternAction,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));
vi.mock('sonner', () => ({ toast: toastMock }));

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

import { ResetSettingButton } from '@/components/admin/reset-setting-button';
import { WebhookSecretControls } from '@/components/admin/webhook-secret-controls';
import { SyncScheduleEditor } from '@/components/admin/sync-schedule-editor';
import { OneCParamsForm } from '@/components/admin/one-c-params-form';

beforeEach(() => {
  vi.clearAllMocks();
  actions.resetSettingToServerValueAction.mockResolvedValue({ ok: true });
  actions.generateWebhookSecretAction.mockResolvedValue({ ok: true, secret: 'тайна-123' });
  actions.registerWebhookAction.mockResolvedValue({ ok: true, message: 'Вебхук зарегистрирован' });
  actions.saveSchedulePatternAction.mockResolvedValue({ ok: true });
});

describe('ResetSettingButton — «использовать значение сервера»', () => {
  it('сразу не сбрасывает: сначала спрашивает', () => {
    render(<ResetSettingButton settingKey="onec.mode" label="Режим" />);

    fireEvent.click(screen.getByRole('button', { name: 'использовать значение сервера' }));

    expect(screen.getByText('Убрать заданное здесь значение?')).toBeTruthy();
    expect(actions.resetSettingToServerValueAction).not.toHaveBeenCalled();
  });

  it('«отмена» возвращает всё как было', () => {
    render(<ResetSettingButton settingKey="onec.mode" label="Режим" />);

    fireEvent.click(screen.getByRole('button', { name: 'использовать значение сервера' }));
    fireEvent.click(screen.getByRole('button', { name: 'отмена' }));

    expect(screen.getByRole('button', { name: 'использовать значение сервера' })).toBeTruthy();
    expect(actions.resetSettingToServerValueAction).not.toHaveBeenCalled();
  });

  it('«да» сбрасывает и называет настройку по имени', async () => {
    render(<ResetSettingButton settingKey="onec.mode" label="Режим" />);

    fireEvent.click(screen.getByRole('button', { name: 'использовать значение сервера' }));
    fireEvent.click(screen.getByRole('button', { name: 'да' }));

    await waitFor(() =>
      expect(actions.resetSettingToServerValueAction).toHaveBeenCalledWith('onec.mode')
    );
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('«Режим»: снова действует значение сервера.')
    );
  });

  it('отказ показывается по-русски', async () => {
    actions.resetSettingToServerValueAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<ResetSettingButton settingKey="onec.mode" label="Режим" />);

    fireEvent.click(screen.getByRole('button', { name: 'использовать значение сервера' }));
    fireEvent.click(screen.getByRole('button', { name: 'да' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(String(toastMock.error.mock.calls[0]?.[0])).not.toBe('forbidden');
  });
});

describe('WebhookSecretControls — секрет вебхука', () => {
  it('провайдер без регистрации по API не получает мёртвую кнопку', () => {
    render(<WebhookSecretControls provider="whatsapp" canRegister={false} />);

    expect(screen.queryByRole('button', { name: 'Зарегистрировать вебхук' })).toBeNull();
  });

  it('секрет показывается один раз и честно предупреждает об этом', async () => {
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать секрет' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('второй раз он не покажется');
    expect(status.textContent).toContain('тайна-123');
  });

  it('нет ключа шифрования — объясняем причину, а не «что-то пошло не так»', async () => {
    actions.generateWebhookSecretAction.mockResolvedValue({
      ok: false,
      error: 'secrets_key_missing',
    });
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать секрет' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'На сервере не задан ключ шифрования — секрет сохранить нельзя.'
      )
    );
  });

  it('прочий сбой генерации — общее сообщение', async () => {
    actions.generateWebhookSecretAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать секрет' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Не удалось сгенерировать секрет.')
    );
  });

  it('регистрация вебхука сообщает ответ провайдера', async () => {
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать вебхук' }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Вебхук зарегистрирован'));
  });

  it.each([
    ['no_token', 'Сначала сохраните токен бота.'],
    ['provider_error', 'Провайдер не принял адрес. Проверьте токен и доступность сайта извне.'],
  ])('отказ «%s» переводится в понятную фразу', async (error, text) => {
    actions.registerWebhookAction.mockResolvedValue({ ok: false, error });
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать вебхук' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(text));
  });

  it('незнакомый код отказа не оставляет человека без объяснения', async () => {
    actions.registerWebhookAction.mockResolvedValue({ ok: false, error: 'что-то новое' });
    render(<WebhookSecretControls provider="telegram" canRegister />);

    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать вебхук' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Не удалось зарегистрировать вебхук.')
    );
  });
});

describe('SyncScheduleEditor — расписание обмена', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Расписание:/ }));

  it('свёрнутый вид показывает текущее выражение', () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="*/15 * * * *" isDefault />
    );

    expect(screen.getByRole('button', { name: /\*\/15 \* \* \* \*/ })).toBeTruthy();
  });

  it('рядом с выражением показываются даты ближайших запусков — не звёздочки', () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="*/15 * * * *" isDefault />
    );
    open();

    expect(screen.getByText('Ближайшие запуски:')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('выражение разбирается, но не сработает никогда — предупреждаем, а не показываем пустоту', () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="* * * * *" isDefault />
    );
    open();

    // 30 февраля не наступает: выражение правильное, запусков не будет.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '0 0 30 2 *' } });

    expect(screen.getByText(/Ближайшие четыре года запусков не будет/)).toBeTruthy();
  });

  it('кривое выражение объясняется словами, а «Сохранить» не нажимается', () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="* * * * *" isDefault />
    );
    open();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'совсем не расписание' } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('готовый вариант подставляется одним нажатием и сохраняется', async () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="*/15 * * * *" isDefault />
    );
    open();

    const presets = screen
      .getAllByRole('button')
      .filter((b) => /каждый|раз/i.test(b.textContent ?? ''));
    expect(presets.length).toBeGreaterThan(0);
    fireEvent.click(presets[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(actions.saveSchedulePatternAction).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith(
      'Расписание сохранено. Оно применится при следующем запуске обмена.'
    );
  });

  it('«вернуть стандартное» есть только там, где умолчание перекрыто', () => {
    const { unmount } = render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="0 * * * *" isDefault />
    );
    open();
    expect(screen.queryByRole('button', { name: 'вернуть стандартное' })).toBeNull();
    unmount();

    render(
      <SyncScheduleEditor
        schedulerId="s1"
        tz="Europe/Moscow"
        current="0 * * * *"
        isDefault={false}
      />
    );
    open();
    expect(screen.getByRole('button', { name: 'вернуть стандартное' })).toBeTruthy();
  });

  it('«вернуть стандартное» шлёт пустую строку', async () => {
    render(
      <SyncScheduleEditor
        schedulerId="s1"
        tz="Europe/Moscow"
        current="0 * * * *"
        isDefault={false}
      />
    );
    open();

    fireEvent.click(screen.getByRole('button', { name: 'вернуть стандартное' }));

    await waitFor(() => expect(actions.saveSchedulePatternAction).toHaveBeenCalledWith('s1', ''));
  });

  it('отмена возвращает прежнее выражение', () => {
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="0 * * * *" isDefault />
    );
    open();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '*/5 * * * *' } });
    fireEvent.click(screen.getByRole('button', { name: 'отмена' }));

    expect(screen.getByRole('button', { name: /0 \* \* \* \*/ })).toBeTruthy();
  });

  it.each([
    ['invalid_cron', 'Сервер не разобрал'],
    ['not_found', 'Неизвестная задача.'],
  ])('отказ сервера «%s» показывается человеку', async (error, text) => {
    actions.saveSchedulePatternAction.mockResolvedValue(
      error === 'invalid_cron'
        ? { ok: false, error, message: 'Сервер не разобрал' }
        : { ok: false, error }
    );
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="0 * * * *" isDefault />
    );
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(text));
  });

  it('отказ invalid_cron без пояснения не оставляет пустоту', async () => {
    actions.saveSchedulePatternAction.mockResolvedValue({ ok: false, error: 'invalid_cron' });
    render(
      <SyncScheduleEditor schedulerId="s1" tz="Europe/Moscow" current="0 * * * *" isDefault />
    );
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Расписание не разобрано.'));
  });
});

describe('OneCParamsForm — параметры обмена с 1С', () => {
  const initial = {
    mode: 'shadow',
    httpTimeoutMs: '15000',
    cursorOverlapMinutes: '5',
    defaultCompanyId: '',
    pendingMaxAttempts: '50',
    pendingMaxAgeDays: '7',
  };

  it('переключение в боевой режим спрашивает подтверждение', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const confirm = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal('confirm', confirm);

    const { container } = render(
      <OneCParamsForm
        initial={initial}
        companies={[{ id: 'c1', name: 'ООО «Первая»' }]}
        action={action}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Теневой — только читаем, в 1С не пишем'), {
      target: { value: 'live' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0]?.[0])).toContain('боевой режим');
    await waitFor(() => expect(action).toHaveBeenCalled());
  });

  it('отказ от подтверждения ничего не сохраняет', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );

    const { container } = render(
      <OneCParamsForm initial={initial} companies={[]} action={action} />
    );

    fireEvent.change(screen.getByDisplayValue('Теневой — только читаем, в 1С не пишем'), {
      target: { value: 'live' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await new Promise((r) => setTimeout(r, 0));
    expect(action).not.toHaveBeenCalled();
  });

  it('если режим и так боевой — лишнего вопроса нет', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const confirm = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal('confirm', confirm);

    const { container } = render(
      <OneCParamsForm initial={{ ...initial, mode: 'live' }} companies={[]} action={action} />
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('успех подтверждается словом «Сохранено», отказ — понятной строкой', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { container, rerender } = render(
      <OneCParamsForm initial={initial} companies={[]} action={action} />
    );

    fireEvent.submit(container.querySelector('form')!);
    expect((await screen.findByRole('status')).textContent).toContain('Сохранено');

    const failing = vi.fn().mockResolvedValue({ ok: false, error: 'value_out_of_range' });
    rerender(<OneCParamsForm initial={initial} companies={[]} action={failing} />);
    fireEvent.submit(container.querySelector('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('вне допустимых границ');
  });

  it('пустая компания по умолчанию честно объясняет последствие', () => {
    render(<OneCParamsForm initial={initial} companies={[]} action={vi.fn()} />);

    expect(screen.getByText('Не выбрана — новые организации создаваться не будут')).toBeTruthy();
  });
});
