// @vitest-environment jsdom
/**
 * Полоса «пакет считается» (этап 2 PR-3, `У-193`, спека §3.2).
 *
 * Страница пакета серверная, поэтому состояние спрашивается по таймеру — но
 * только пока пакет в работе и только при открытой вкладке. Проверяем интервал
 * в 3 секунды, русские названия шагов, остановку по конечному статусу с
 * обновлением страницы и молчание у готового пакета.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

// Роутер — ОДИН объект на прогон: `useRouter()` в Next стабилен, а полоса
// держит `router` в зависимостях эффекта. Новый объект на каждый рендер
// перезапускал бы эффект бесконечно.
const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh, push: vi.fn() } };
});
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { getBitrixBatchStateAction } = vi.hoisted(() => ({ getBitrixBatchStateAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => ({ getBitrixBatchStateAction }));

import { BatchProgress } from '@/components/bitrix/batch-progress';

/** В jsdom `visibilityState` — read-only геттер, поэтому подменяем свойство. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

type State = Awaited<ReturnType<typeof getBitrixBatchStateAction>>;
function working(over: Partial<{ step: string; done: number; total: number }> = {}) {
  return {
    ok: true,
    status: 'preview_pending',
    progress: { step: 'deal', done: 12, total: 100, ...over },
  } as State;
}

/** Прокрутить время (0 — только дождаться первого, немедленного опроса). */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderProgress(status: string, batchId = 'b-1') {
  const utils = render(React.createElement(BatchProgress, { batchId, status }));
  return {
    ...utils,
    box: () => utils.container.querySelector('[role="status"]'),
    text: () => utils.container.textContent ?? '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  setVisibility('visible');
  getBitrixBatchStateAction.mockResolvedValue(working());
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('BatchProgress', () => {
  it('пакет в работе: сразу спрашивает состояние и показывает число записей и русский шаг', async () => {
    const ui = renderProgress('preview_pending');

    // До первого ответа — честное «задача в очереди», а не пустота.
    expect(ui.box()).not.toBeNull();
    expect(ui.text()).toContain('Считаем предпросмотр…');
    expect(ui.text()).toContain('Задача поставлена в очередь');

    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenCalledWith('b-1');
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);
    expect(ui.text()).toContain('Обработано записей: 12. Сейчас — сделки.');
  });

  it('опрашивает каждые 3 секунды, пока пакет в работе', async () => {
    renderProgress('preview_pending');
    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);

    // Между тиками лишних походов нет.
    await tick(2999);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);

    await tick(1);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(2);
    await tick(3000);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['users', 'сотрудники'],
    ['stages', 'стадии'],
    ['organization', 'организации'],
    ['contact', 'контакты'],
    ['lead', 'лиды'],
    ['deal', 'сделки'],
    ['note', 'заметки'],
    ['task', 'задачи'],
    ['file', 'файлы'],
    ['order', 'заказы'],
  ])('шаг %s показывается словом «%s»', async (step, label) => {
    getBitrixBatchStateAction.mockResolvedValue(working({ step, done: 5 }));
    const ui = renderProgress('preview_pending');
    await tick();
    expect(ui.text()).toContain(`Обработано записей: 5. Сейчас — ${label}.`);
  });

  it('незнакомый шаг показывается кодом — лучше видимый код, чем немая полоса', async () => {
    getBitrixBatchStateAction.mockResolvedValue(working({ step: 'requisites', done: 1 }));
    const ui = renderProgress('preview_pending');
    await tick();
    expect(ui.text()).toContain('Сейчас — requisites.');
  });

  it('ответ без прогресса ничего не меняет — остаётся «задача в очереди»', async () => {
    getBitrixBatchStateAction.mockResolvedValue({
      ok: true,
      status: 'preview_pending',
      progress: null,
    } as State);
    const ui = renderProgress('preview_pending');
    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);
    expect(ui.text()).toContain('Задача поставлена в очередь');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('отказ (пакет исчез или нет прав) не ломает полосу и не обновляет страницу', async () => {
    getBitrixBatchStateAction.mockResolvedValue({ ok: false, error: 'not_found' } as State);
    const ui = renderProgress('preview_pending');
    await tick();
    await tick(3000);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(2);
    expect(ui.text()).toContain('Задача поставлена в очередь');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('пакет досчитался: страница обновляется один раз, и перерисовка снимает таймер', async () => {
    getBitrixBatchStateAction.mockResolvedValueOnce(working({ done: 40 })).mockResolvedValue({
      ok: true,
      status: 'preview',
      progress: { step: 'order', done: 90, total: 90 },
    } as State);

    const ui = renderProgress('preview_pending');
    await tick();
    expect(ui.text()).toContain('Обработано записей: 40');

    await tick(3000); // второй ответ — статус конечный
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ui.text()).toContain('Обработано записей: 90');

    // Даже если сервер ещё не перерисовал страницу, повторного обновления нет.
    await tick(3000);
    await tick(3000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // `router.refresh()` приносит новый статус — полоса пропадает, опрос встаёт.
    const callsBefore = getBitrixBatchStateAction.mock.calls.length;
    ui.rerender(React.createElement(BatchProgress, { batchId: 'b-1', status: 'preview' }));
    expect(ui.box()).toBeNull();
    await tick(9000);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(callsBefore);
  });

  it.each(['preview', 'applied', 'rolled_back', 'rollback_partial', 'failed'])(
    'конечный статус %s: полосы нет и опроса нет',
    async (status) => {
      const ui = renderProgress(status);
      expect(ui.box()).toBeNull();
      expect(ui.container.innerHTML).toBe('');
      await tick(9000);
      expect(getBitrixBatchStateAction).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it.each(['applying', 'rolling_back'])('рабочий статус %s тоже опрашивается', async (status) => {
    const ui = renderProgress(status);
    expect(ui.box()).not.toBeNull();
    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);
  });

  it('вкладка в фоне: опроса нет вовсе; вернулись — опрос пошёл', async () => {
    setVisibility('hidden');
    renderProgress('preview_pending');
    await tick();
    await tick(3000);
    await tick(3000);
    expect(getBitrixBatchStateAction).not.toHaveBeenCalled();

    setVisibility('visible');
    await tick(3000);
    expect(getBitrixBatchStateAction).toHaveBeenCalledTimes(1);
  });

  it('ушли со страницы, пока ответ в пути — состояние не трогаем', async () => {
    let release!: (v: State) => void;
    getBitrixBatchStateAction.mockImplementation(
      () =>
        new Promise<State>((resolve) => {
          release = resolve;
        })
    );
    const ui = renderProgress('preview_pending');
    await tick();
    ui.unmount();

    await act(async () => {
      release(working({ done: 7 }));
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('смена пакета перезапускает опрос на новый идентификатор', async () => {
    const ui = renderProgress('preview_pending', 'b-1');
    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenLastCalledWith('b-1');

    ui.rerender(React.createElement(BatchProgress, { batchId: 'b-2', status: 'preview_pending' }));
    await tick();
    expect(getBitrixBatchStateAction).toHaveBeenLastCalledWith('b-2');
  });
});
