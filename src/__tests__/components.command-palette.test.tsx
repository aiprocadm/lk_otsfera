// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { CommandPalette } from '@/components/shell/command-palette';

const { push, searchAction } = vi.hoisted(() => ({
  push: vi.fn(),
  searchAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/server-actions/search', () => ({ paletteSearchAction: searchAction }));

const SECTIONS = [
  { href: '/manager/orders', label: 'Заказы' },
  { href: '/manager/students', label: 'Слушатели' },
  { href: '/manager/documents', label: 'Документы' },
];

/** Диалог всегда смонтирован — работаем только с открытым. */
function dialog() {
  const el = document.querySelector('dialog[open]');
  if (!el) throw new Error('палитра закрыта');
  return within(el as HTMLElement);
}

function openPalette() {
  fireEvent.click(screen.getByTestId('palette-open'));
}

beforeAll(() => {
  // jsdom не умеет нативный <dialog> — тот же приём, что и в остальных
  // тестах модалок проекта.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  push.mockClear();
  searchAction.mockReset();
  vi.useRealTimers();
});

afterEach(() => cleanup());

describe('CommandPalette (У-75) — переходы по разделам', () => {
  it('открывается по Ctrl+K и закрывается повторным нажатием', () => {
    render(<CommandPalette sections={SECTIONS} />);
    expect(document.querySelector('dialog[open]')).toBeNull();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(document.querySelector('dialog[open]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('открывается по ⌘K на Mac', () => {
    render(<CommandPalette sections={SECTIONS} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('обычная буква «k» палитру не открывает', () => {
    render(<CommandPalette sections={SECTIONS} />);
    fireEvent.keyDown(document, { key: 'k' });
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('открывается кнопкой в шапке — для тех, кто не знает горячих клавиш', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('без запроса показывает все разделы своей роли', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    const list = dialog().getByTestId('palette-sections');
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('фильтрует разделы по названию без учёта регистра', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'СЛУШ' } });
    const list = dialog().getByTestId('palette-sections');
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Слушатели']);
  });

  it('когда совпадений нет — объясняет, а не показывает пустоту', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'ракета' } });
    expect(dialog().getByTestId('palette-no-sections').textContent).toContain(
      'Разделов с таким названием нет'
    );
  });

  it('клик по разделу ведёт по его адресу и закрывает палитру', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    fireEvent.click(dialog().getByTestId('palette-section-/manager/students'));
    expect(push).toHaveBeenCalledWith('/manager/students');
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('Enter ведёт в первый подходящий раздел', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    const input = dialog().getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'док' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(push).toHaveBeenCalledWith('/manager/documents');
  });

  it('Enter без единого совпадения никуда не ведёт', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    const input = dialog().getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'ракета' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(push).not.toHaveBeenCalled();
  });

  it('закрытие крестиком не роняет экран', () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    const close = dialog().getByRole('button', { name: /закрыть/i });
    fireEvent.click(close);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });
});

describe('CommandPalette (У-75) — поиск по данным', () => {
  it('без searchEnabled поиска по данным нет вовсе — это роли без своего поиска', async () => {
    render(<CommandPalette sections={SECTIONS} />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    await waitFor(() => expect(searchAction).not.toHaveBeenCalled());
    expect(document.querySelector('[data-testid="palette-data"]')).toBeNull();
  });

  it('короткий запрос в базу не уходит', async () => {
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'и' } });
    await new Promise((r) => setTimeout(r, 320));
    expect(searchAction).not.toHaveBeenCalled();
  });

  it('находки показываются группами и ведут по своим адресам', async () => {
    searchAction.mockResolvedValue({
      ok: true,
      query: 'иванов',
      groups: [
        {
          key: 'students',
          labelRu: 'Слушатели',
          limited: false,
          hits: [{ href: '/manager/students/s1', title: 'Иванов Иван' }],
        },
        { key: 'orders', labelRu: 'Заказы', limited: false, hits: [] },
      ],
    });
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });

    const hit = await dialog().findByRole('button', { name: 'Иванов Иван' });
    // Пустая группа «Заказы» не показывается — иначе экран забит пустотой.
    expect(dialog().queryByText('Заказы')).toBeNull();
    fireEvent.click(hit);
    expect(push).toHaveBeenCalledWith('/manager/students/s1');
  });

  it('пока ищем — так и написано', async () => {
    searchAction.mockImplementation(() => new Promise(() => {}));
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    expect(await dialog().findByText('Ищем…')).toBeTruthy();
  });

  it('пустая выдача объясняется словами', async () => {
    searchAction.mockResolvedValue({ ok: true, query: 'иванов', groups: [] });
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    expect(await dialog().findByText(/Ничего не нашлось/)).toBeTruthy();
  });

  it('отказ сервиса не ломает палитру — разделы остаются на месте', async () => {
    searchAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    // Слово подобрано так, чтобы совпал и раздел: проверяем, что отказ поиска
    // по данным не уносит с собой переходы по разделам.
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'заказ' } });
    expect(await dialog().findByText(/Ничего не нашлось/)).toBeTruthy();
    expect(dialog().getByTestId('palette-section-/manager/orders')).toBeTruthy();
  });

  it('сбой сети не роняет экран', async () => {
    searchAction.mockRejectedValue(new Error('offline'));
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    expect(await dialog().findByText(/Ничего не нашлось/)).toBeTruthy();
  });

  it('«Показать все результаты» ведёт на страницу поиска с тем же запросом', async () => {
    searchAction.mockResolvedValue({ ok: true, query: 'иванов', groups: [] });
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    fireEvent.click(await dialog().findByTestId('palette-all-results'));
    expect(push).toHaveBeenCalledWith('/manager/search?q=%D0%B8%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2');
  });

  it('без адреса страницы поиска ссылки «все результаты» нет', async () => {
    searchAction.mockResolvedValue({ ok: true, query: 'иванов', groups: [] });
    render(<CommandPalette sections={SECTIONS} searchEnabled />);
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    await dialog().findByText(/Ничего не нашлось/);
    expect(dialog().queryByTestId('palette-all-results')).toBeNull();
  });

  it('руководитель ищет по всей компании — признак передаётся в сервис', async () => {
    searchAction.mockResolvedValue({ ok: true, query: 'иванов', groups: [] });
    render(
      <CommandPalette sections={SECTIONS} searchEnabled searchHref="/leader/search" teamModeOverride />
    );
    openPalette();
    fireEvent.change(dialog().getByTestId('palette-input'), { target: { value: 'иванов' } });
    await waitFor(() => expect(searchAction).toHaveBeenCalledWith('иванов', true));
  });

  it('быстрый набор шлёт один запрос, а не по одному на букву', async () => {
    searchAction.mockResolvedValue({ ok: true, query: 'ив', groups: [] });
    render(<CommandPalette sections={SECTIONS} searchEnabled searchHref="/manager/search" />);
    openPalette();
    const input = dialog().getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'ив' } });
    fireEvent.change(input, { target: { value: 'ива' } });
    fireEvent.change(input, { target: { value: 'иван' } });
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(1));
    expect(searchAction).toHaveBeenCalledWith('иван', false);
  });
});
