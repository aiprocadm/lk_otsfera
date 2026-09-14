// @vitest-environment jsdom
/**
 * «Повторять перенос еженедельно» (`У-203`) — рычаг параллельного периода.
 *
 * Две недели после первого переноса люди работают сразу в двух системах, и
 * этот блок решает, догоняет ли кабинет Битрикс24 сам. Поэтому проверяем не
 * только вызов действия, но и то, что человек читает: в каком состоянии
 * повтор сейчас, по какому расписанию он ходит и что случится от нажатия.
 * Кнопка, которая не сказала, включает она или выключает, — дефект приёмки
 * (§15), а не мелочь оформления.
 *
 * Отдельно стережём область ошибки: она смонтирована ВСЕГДА и прячется
 * классом `sr-only`. Появись она только вместе с текстом — экранный диктор
 * промолчал бы об отказе, потому что `aria-live` объявляет изменения внутри
 * уже существующей области, а не её рождение.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ setBitrixResyncPausedAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { ResyncSchedule } from '@/components/bitrix/resync-schedule';

/** Расписание по умолчанию — ночь с воскресенья на понедельник. */
const PATTERN = '0 3 * * 1';

beforeEach(() => {
  vi.clearAllMocks();
  // Умолчание: повтор включили, паузы больше нет.
  actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: true, paused: false });
});

function mount(props: Partial<React.ComponentProps<typeof ResyncSchedule>> = {}) {
  return render(<ResyncSchedule paused pattern={PATTERN} {...props} />);
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** Область отказа: всегда в разметке, ищется по `aria-live`, а не по тексту. */
function liveRegion(): HTMLElement {
  const region = document.querySelector('[aria-live="polite"]');
  expect(region).not.toBeNull();
  return region as HTMLElement;
}

describe('ResyncSchedule — что человек видит до нажатия', () => {
  it('повтор выключен: кнопка предлагает включить, текст объясняет, что переносы только вручную', () => {
    mount({ paused: true });

    expect(button('Повторять еженедельно')).toHaveProperty('disabled', false);
    expect(
      screen.getByText('Сейчас повтор выключен — переносы запускаются только вручную.')
    ).toBeTruthy();
    // Обратная подпись рядом была бы враньём про текущее состояние.
    expect(screen.queryByRole('button', { name: 'Выключить повтор' })).toBeNull();
  });

  it('повтор включён: кнопка предлагает выключить, текст объясняет, когда это делать', () => {
    mount({ paused: false });

    expect(button('Выключить повтор')).toHaveProperty('disabled', false);
    expect(
      screen.getByText('Сейчас повтор включён. Выключите его, когда Битрикс24 отключат.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторять еженедельно' })).toBeNull();
  });

  it('расписание показано как есть: «еженедельно» без времени — обещание без срока', () => {
    // Паттерн приезжает из базы, а не из кода: воркер мог давно ходить по
    // другому расписанию, и экран обязан показывать именно его.
    const { container } = mount({ pattern: '0 5 * * 3' });

    expect(container.querySelector('code')?.textContent).toBe('0 5 * * 3');
    expect(container.querySelector('h2')?.textContent).toBe('Повторять перенос еженедельно');
    const text = container.textContent ?? '';
    expect(text).toContain('берёт настройки последнего применённого');
    // Главный страх человека: «а мои правки после переноса?» — отвечаем сразу.
    expect(text).toContain('не трогает поля, поправленные людьми');
  });
});

describe('ResyncSchedule — переключение', () => {
  it('выключенный повтор включается: действие зовётся со снятием паузы, тост и перечитывание экрана', async () => {
    actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: true, paused: false });
    mount({ paused: true });

    fireEvent.click(button('Повторять еженедельно'));

    // `false` = «снять паузу»: аргумент — желаемое состояние, а не текущее.
    await waitFor(() => expect(actions.setBitrixResyncPausedAction).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Еженедельный повтор включён')
    );
    // Без перечитывания подпись кнопки осталась бы прежней — человек решил бы,
    // что нажатие не сработало, и нажал ещё раз.
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(liveRegion().textContent).toBe('');
  });

  it('включённый повтор выключается: действие зовётся с паузой, тост говорит именно об этом', async () => {
    actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: true, paused: true });
    mount({ paused: false });

    fireEvent.click(button('Выключить повтор'));

    await waitFor(() => expect(actions.setBitrixResyncPausedAction).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Еженедельный повтор выключен')
    );
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('пока идёт запрос — «Сохраняем…», кнопка мертва: второй клик не ставит паузу дважды', async () => {
    let finish: (v: unknown) => void = () => {};
    actions.setBitrixResyncPausedAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    mount({ paused: true });

    fireEvent.click(button('Повторять еженедельно'));

    const saving = await waitFor(() => button('Сохраняем…'));
    expect(saving).toHaveProperty('disabled', true);
    fireEvent.click(saving);
    expect(actions.setBitrixResyncPausedAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ ok: true, paused: false });
    });
    // Запрос закончился — подпись вернулась, кнопка снова живая.
    await waitFor(() => expect(button('Повторять еженедельно')).toHaveProperty('disabled', false));
  });
});

describe('ResyncSchedule — отказы', () => {
  it.each([
    ['queue_unavailable', 'Очередь фоновых задач недоступна. Попробуйте позже.'],
    ['unknown_schedule', 'Расписание не найдено — обновите страницу.'],
    ['forbidden', 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.'],
  ])('отказ %s объяснён по-русски, экран не перечитывается', async (error, text) => {
    actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: false, error });
    mount({ paused: true });

    fireEvent.click(button('Повторять еженедельно'));

    await waitFor(() => expect(liveRegion().textContent).toBe(text));
    // Ничего не изменилось — перечитывать нечего, а тост соврал бы об успехе.
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    // Кнопка снова живая: можно попробовать ещё раз.
    expect(button('Повторять еженедельно')).toHaveProperty('disabled', false);
  });

  it('незнакомый код показывается сам — немого блока не остаётся', async () => {
    // Общий `resolveErrorText`: код, которого нет в словаре, доходит до
    // человека дословно. Иначе новый код ошибки давал бы пустую область.
    actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: false, error: 'boom' });
    mount({ paused: false });

    fireEvent.click(button('Выключить повтор'));

    await waitFor(() => expect(liveRegion().textContent).toBe('Ошибка: boom'));
  });
});

describe('ResyncSchedule — доступность области ошибки', () => {
  it('пустая область смонтирована и спрятана классом sr-only', () => {
    mount({ paused: true });

    const region = liveRegion();
    expect(region.textContent).toBe('');
    // Скрываем классом, а не размонтированием: `aria-live` объявляет
    // изменения внутри существующей области.
    expect(region.className).toContain('sr-only');
  });

  it('с текстом та же область становится видимой и красной', async () => {
    actions.setBitrixResyncPausedAction.mockResolvedValue({
      ok: false,
      error: 'queue_unavailable',
    });
    mount({ paused: true });

    fireEvent.click(button('Повторять еженедельно'));

    await waitFor(() => expect(liveRegion().className).toContain('text-red-600'));
    expect(liveRegion().className).not.toContain('sr-only');
    // Область — одна и та же: вторая рядом сбила бы чтение с экрана.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('повторная попытка убирает прежний отказ — старый текст не висит над новым результатом', async () => {
    actions.setBitrixResyncPausedAction.mockResolvedValueOnce({
      ok: false,
      error: 'queue_unavailable',
    });
    mount({ paused: true });

    fireEvent.click(button('Повторять еженедельно'));
    await waitFor(() =>
      expect(liveRegion().textContent).toBe('Очередь фоновых задач недоступна. Попробуйте позже.')
    );

    actions.setBitrixResyncPausedAction.mockResolvedValue({ ok: true, paused: false });
    fireEvent.click(button('Повторять еженедельно'));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(liveRegion().textContent).toBe('');
    expect(liveRegion().className).toContain('sr-only');
  });
});
