// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Панель состояния интеграций (`У-70`) и включение каналов (`У-69`).
 *
 * Раньше человек видел «Подключено / Не настроено», а причина отказа лежала
 * отдельно, ниже по странице. Проверяем, что теперь состояние и его причина
 * рядом, а канал включается там же, где вводятся ключи.
 */
const { setFeatureFlagAction } = vi.hoisted(() => ({ setFeatureFlagAction: vi.fn() }));
vi.mock('@/server-actions/feature-flags', () => ({ setFeatureFlagAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { IntegrationsHealthPanel } from '@/components/admin/integrations-health-panel';
import type { IntegrationHealthRow } from '@/lib/services/admin/integrationsHealth';

function row(over: Partial<IntegrationHealthRow> = {}): IntegrationHealthRow {
  return {
    key: 'max',
    label: 'Max-бот',
    description: 'Уведомления через Max',
    status: 'ok',
    lastCheckedAt: '2026-08-12T10:00:00.000Z',
    lastError: null,
    flag: 'max_channel',
    flagEnabled: false,
    flagEditable: true,
    documentsNotPushed: null,
    ...over,
  };
}

/** Карточка 1С — единственная, где есть счётчик невыгруженных документов (`У-174`). */
function onec(over: Partial<IntegrationHealthRow> = {}): IntegrationHealthRow {
  return row({
    key: 'onec',
    label: '1С',
    flag: null,
    documentsNotPushed: { count: 0, threshold: 0 },
    ...over,
  });
}

beforeEach(() => {
  setFeatureFlagAction.mockReset();
  toastSuccess.mockClear();
  refresh.mockClear();
});

describe('IntegrationsHealthPanel (У-69, У-70)', () => {
  it('три состояния светофора показаны словами, а не цветом', () => {
    render(
      <IntegrationsHealthPanel
        rows={[
          row(),
          row({ key: 'email', label: 'Почта', status: 'error', lastError: 'SMTP timeout' }),
          row({ key: 'dadata', label: 'DaData', status: 'not_configured', flag: null }),
        ]}
      />
    );
    expect(screen.getByTestId('integration-status-max').textContent).toBe('работает');
    expect(screen.getByTestId('integration-status-email').textContent).toBe('ошибка');
    expect(screen.getByTestId('integration-status-dadata').textContent).toBe('не настроено');
    // Текст последней ошибки — рядом, а не в другом разделе страницы.
    expect(screen.getByTestId('integration-error-email').textContent).toBe('SMTP timeout');
  });

  it('дата последней проверки видна, а у непроверенных — подсказка, что делать', () => {
    render(
      <IntegrationsHealthPanel
        rows={[
          row(),
          row({ key: 'imap', label: 'Входящая почта', status: 'unchecked', lastCheckedAt: null }),
        ]}
      />
    );
    expect(screen.getByTestId('integration-max').textContent).toContain('Проверено:');
    expect(screen.getByTestId('integration-status-imap').textContent).toBe(
      'проверка не запускалась'
    );
    // §15 «что делать дальше»: экран не просто констатирует, а подсказывает.
    expect(screen.getByTestId('integration-imap').textContent).toContain('Проверить подключение');
  });

  it('У-69: канал включается кнопкой на своей карточке', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: true, source: 'ui' });
    render(<IntegrationsHealthPanel rows={[row()]} />);

    fireEvent.click(screen.getByTestId('channel-toggle-max'));
    await waitFor(() => expect(setFeatureFlagAction).toHaveBeenCalledWith('max_channel', true));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Канал включён — применится в течение минуты')
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('включённый канал предлагает выключение', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: false, source: 'ui' });
    render(<IntegrationsHealthPanel rows={[row({ flagEnabled: true })]} />);

    expect(screen.getByTestId('channel-toggle-max').textContent).toBe('Выключить канал');
    fireEvent.click(screen.getByTestId('channel-toggle-max'));
    await waitFor(() => expect(setFeatureFlagAction).toHaveBeenCalledWith('max_channel', false));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Канал выключен — применится в течение минуты')
    );
  });

  it('телефония объясняет, почему переключателя нет', () => {
    render(
      <IntegrationsHealthPanel
        rows={[
          row({
            key: 'mango',
            label: 'Телефония',
            flag: 'telephony_mango',
            flagEditable: false,
          }),
        ]}
      />
    );
    expect(screen.getByTestId('channel-locked-mango').textContent).toContain('на сервере');
    expect(screen.queryByTestId('channel-toggle-mango')).toBeNull();
  });

  it('у интеграции без флага канала кнопки нет вовсе', () => {
    render(<IntegrationsHealthPanel rows={[row({ key: 'telegram', flag: null })]} />);
    expect(screen.queryByTestId('channel-toggle-telegram')).toBeNull();
    expect(screen.queryByTestId('channel-locked-telegram')).toBeNull();
  });

  it('отказ и обрыв связи показываются по-русски', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const view = render(<IntegrationsHealthPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('channel-toggle-max'));
    expect((await screen.findByRole('alert')).textContent).toBe('Недостаточно прав');

    view.unmount();
    setFeatureFlagAction.mockRejectedValue(new Error('offline'));
    render(<IntegrationsHealthPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('channel-toggle-max'));
    expect((await screen.findByRole('alert')).textContent).toContain('Сервер недоступен');
  });

  describe('У-174: «документов не выгружено» на карточке 1С', () => {
    it('число видно даже при нуле — молчание читалось бы как «не считали»', () => {
      render(<IntegrationsHealthPanel rows={[onec(), row()]} />);
      expect(screen.getByTestId('integration-push-failed-onec').textContent).toBe(
        'Документов не выгружено: 0'
      );
      expect(screen.queryByTestId('integration-push-failed-max')).toBeNull();
    });

    it('выше порога — «работает с ошибками», число с порогом и подсказка, что нажать', () => {
      render(
        <IntegrationsHealthPanel
          rows={[onec({ status: 'degraded', documentsNotPushed: { count: 3, threshold: 2 } })]}
        />
      );
      expect(screen.getByTestId('integration-status-onec').textContent).toBe('работает с ошибками');
      const line = screen.getByTestId('integration-push-failed-onec').textContent ?? '';
      expect(line).toContain('Документа не выгружено: 3');
      expect(line).toContain('порога (2)');
      expect(line).toContain('«Повторить»');
    });

    it('число ведёт в список с фильтром «не выгружен», когда страница дала адрес', () => {
      render(
        <IntegrationsHealthPanel
          rows={[onec({ documentsNotPushed: { count: 1, threshold: 0 }, status: 'degraded' })]}
          failedDocumentsHref="/leader/documents?oneCPushStatus=failed"
        />
      );
      const link = screen.getByRole('link', { name: 'Документ не выгружен: 1' });
      expect(link.getAttribute('href')).toBe('/leader/documents?oneCPushStatus=failed');
    });

    it('без адреса — просто текст, без ссылки в никуда', () => {
      render(<IntegrationsHealthPanel rows={[onec()]} />);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  it('неизвестный код ошибки не прячется', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(<IntegrationsHealthPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('channel-toggle-max'));
    expect((await screen.findByRole('alert')).textContent).toContain('Ошибка: mystery');
  });
});
