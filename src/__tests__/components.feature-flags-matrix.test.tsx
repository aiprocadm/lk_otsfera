// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * Матрица функций платформы (`У-65`…`У-68`).
 *
 * До этапа 8 экран был только для чтения. Теперь проверяем то, ради чего он
 * переделан: переключение работает, видно откуда взято значение, опасные
 * функции спрашивают подтверждение с текстом последствия, а функции,
 * закрывающие раздел, переключить нельзя вовсе.
 */
const { setFeatureFlagAction } = vi.hoisted(() => ({ setFeatureFlagAction: vi.fn() }));
vi.mock('@/server-actions/feature-flags', () => ({ setFeatureFlagAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { FeatureFlagsMatrix } from '@/components/admin/feature-flags-matrix';
import type { FeatureFlagRow } from '@/lib/services/admin/featureFlags';

function row(over: Partial<FeatureFlagRow> = {}): FeatureFlagRow {
  return {
    flag: 'document_generation',
    enabled: false,
    source: 'default',
    editable: true,
    sensitive: false,
    envVar: 'FEATURE_DOCUMENT_GENERATION',
    defaultEnabled: false,
    ...over,
  };
}

beforeAll(() => {
  // jsdom не реализует нативный <dialog> — мокаем мост примитива.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

beforeEach(() => {
  setFeatureFlagAction.mockReset();
  toastSuccess.mockClear();
  refresh.mockClear();
});

describe('FeatureFlagsMatrix (У-65…У-68)', () => {
  it('обычная функция переключается сразу, без лишних вопросов', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: true, source: 'ui' });
    render(<FeatureFlagsMatrix rows={[row()]} />);

    fireEvent.click(screen.getByTestId('flag-toggle-document_generation'));
    await waitFor(() =>
      expect(setFeatureFlagAction).toHaveBeenCalledWith('document_generation', true)
    );
    // Человеку сказано, что изменение не мгновенное (снапшот живёт до минуты).
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Функция включена — применится в течение минуты')
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('У-66: видно, откуда взято значение, и переменную сервера', () => {
    render(
      <FeatureFlagsMatrix
        rows={[
          row({ source: 'ui', enabled: true }),
          row({ flag: 'pwa_installer', source: 'env', envVar: 'FEATURE_PWA_INSTALLER' }),
          row({ flag: 'staff_chat', source: 'default', envVar: 'FEATURE_STAFF_CHAT' }),
        ]}
      />
    );
    expect(screen.getByTestId('flag-source-document_generation').textContent).toBe('задано здесь');
    expect(screen.getByTestId('flag-source-pwa_installer').textContent).toBe('настройка сервера');
    expect(screen.getByTestId('flag-source-staff_chat').textContent).toBe('по умолчанию');
    // Имя переменной показываем только там, где значение ещё с сервера.
    expect(screen.getByTestId('flag-row-pwa_installer').textContent).toContain(
      'FEATURE_PWA_INSTALLER'
    );
  });

  it('У-68: опасная функция спрашивает подтверждение с текстом последствия', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: false, source: 'ui' });
    render(
      <FeatureFlagsMatrix
        rows={[row({ flag: 'pii_access_log', enabled: true, sensitive: true, source: 'env' })]}
      />
    );

    fireEvent.click(screen.getByTestId('flag-toggle-pii_access_log'));
    // Пока не подтвердили — на сервер ничего не ушло.
    expect(setFeatureFlagAction).not.toHaveBeenCalled();
    const text = (await screen.findByTestId('flag-consequence')).textContent ?? '';
    expect(text).toContain('перестанет вестись');
    expect(text).toContain('только на время инцидента');

    fireEvent.click(screen.getByTestId('flag-confirm'));
    await waitFor(() => expect(setFeatureFlagAction).toHaveBeenCalledWith('pii_access_log', false));
  });

  it('У-68: отказ от подтверждения ничего не меняет', async () => {
    render(
      <FeatureFlagsMatrix
        rows={[row({ flag: 'commission_pdf', enabled: true, sensitive: true })]}
      />
    );
    fireEvent.click(screen.getByTestId('flag-toggle-commission_pdf'));
    await screen.findByTestId('flag-consequence');

    const open = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.click(within(open).getByRole('button', { name: 'Отмена' }));
    // Диалог смонтирован всегда — закрытым он просто не имеет `open` (§6).
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
    expect(setFeatureFlagAction).not.toHaveBeenCalled();
  });

  it('У-68: включение опасной функции тоже подтверждается — и текст другой', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: true, source: 'ui' });
    render(
      <FeatureFlagsMatrix
        rows={[row({ flag: 'pii_access_log', enabled: false, sensitive: true })]}
      />
    );
    fireEvent.click(screen.getByTestId('flag-toggle-pii_access_log'));

    const open = document.querySelector('dialog[open]') as HTMLElement;
    expect(within(open).getByText('Включить функцию?')).toBeTruthy();
    expect((await screen.findByTestId('flag-consequence')).textContent).toContain(
      'снова будет вестись'
    );

    fireEvent.click(screen.getByTestId('flag-confirm'));
    await waitFor(() => expect(setFeatureFlagAction).toHaveBeenCalledWith('pii_access_log', true));
  });

  it('диалог закрывается Escape — и это тоже отказ от переключения', async () => {
    render(
      <FeatureFlagsMatrix
        rows={[row({ flag: 'role_constructor', enabled: true, sensitive: true })]}
      />
    );
    fireEvent.click(screen.getByTestId('flag-toggle-role_constructor'));
    const dialog = document.querySelector('dialog[open]') as HTMLDialogElement;

    // Примитив закрывается по событию `cancel` (Escape в нативном <dialog>).
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
    expect(setFeatureFlagAction).not.toHaveBeenCalled();
  });

  it('можно вернуть настройку сервера, если значение задавали здесь', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: true, enabled: true, source: 'env' });
    render(<FeatureFlagsMatrix rows={[row({ source: 'ui', enabled: false })]} />);

    fireEvent.click(screen.getByTestId('flag-reset-document_generation'));
    await waitFor(() =>
      expect(setFeatureFlagAction).toHaveBeenCalledWith('document_generation', null)
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Значение снова берётся с сервера')
    );
  });

  it('У-65: функция, закрывающая раздел, объясняет, почему кнопки нет', () => {
    render(<FeatureFlagsMatrix rows={[row({ flag: 'manager_cabinet', editable: false })]} />);
    expect(screen.getByTestId('flag-locked-manager_cabinet').textContent).toContain(
      'только на сервере'
    );
    expect(screen.queryByTestId('flag-toggle-manager_cabinet')).toBeNull();
    // «Вернуть настройку сервера» у такой строки тоже быть не может.
    expect(screen.queryByTestId('flag-reset-manager_cabinet')).toBeNull();
  });

  it('отказ сервера показывается по-русски, а не кодом', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: false, error: 'not_editable' });
    render(<FeatureFlagsMatrix rows={[row()]} />);
    fireEvent.click(screen.getByTestId('flag-toggle-document_generation'));
    expect((await screen.findByRole('alert')).textContent).toContain('включается на сервере');
  });

  it('неизвестный код ошибки не превращается в пустой экран', async () => {
    setFeatureFlagAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(<FeatureFlagsMatrix rows={[row()]} />);
    fireEvent.click(screen.getByTestId('flag-toggle-document_generation'));
    expect((await screen.findByRole('alert')).textContent).toContain('Ошибка: mystery');
  });

  it('обрыв связи виден пользователю', async () => {
    setFeatureFlagAction.mockRejectedValue(new Error('offline'));
    render(<FeatureFlagsMatrix rows={[row()]} />);
    fireEvent.click(screen.getByTestId('flag-toggle-document_generation'));
    expect((await screen.findByRole('alert')).textContent).toContain('Сервер недоступен');
  });

  it('инфраструктурные переменные перечислены, но без значений', () => {
    render(<FeatureFlagsMatrix rows={[row()]} />);
    expect(screen.getByText('DATABASE_URL')).toBeTruthy();
    expect(screen.getByText(/подпись сессий/)).toBeTruthy();
  });
});
