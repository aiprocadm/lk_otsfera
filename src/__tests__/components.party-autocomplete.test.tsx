// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import {
  PartyAutocomplete,
  type PartyAutocompleteSuggestion,
} from '@/components/party/party-autocomplete';

/**
 * Этап 5 PR-2 (ФТ-13.3): презентационный автокомплит организации через
 * /api/suggest/party. Fake timers (debounce 300мс) + fetch-шпион:
 *  - <2 символов не фетчит; быстрый ввод → один fetch (debounce);
 *  - выпадашка с подсказками, клик → onSelect с полным объектом + закрытие;
 *  - клавиатура: стрелки/Enter/Escape; aria-атрибуты combobox/listbox;
 *  - пустой ответ / не-ok / сетевая ошибка → молча нет выпадашки;
 *  - поздний ответ устаревшего запроса отсекается.
 */

const SUGGESTION: PartyAutocompleteSuggestion = {
  name: 'ООО Ромашка',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700092661',
  address: 'г. Москва, ул. Ленина, 1',
};
const SUGGESTION_2: PartyAutocompleteSuggestion = {
  name: 'ООО Василёк',
  inn: '7707083894',
  kpp: null,
  ogrn: null,
  address: null,
};

function okJson(body: unknown) {
  return { ok: true, json: async () => body };
}

function Harness({
  onSelect,
  noId,
}: {
  onSelect: (s: PartyAutocompleteSuggestion) => void;
  noId?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <PartyAutocomplete
      id={noId ? undefined : 'pa'}
      value={value}
      onChange={setValue}
      onSelect={(s) => {
        setValue(s.name);
        onSelect(s);
      }}
      placeholder="Название компании"
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let onSelect: ReturnType<typeof vi.fn>;

function input(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

async function typeAndSettle(text: string, ms = 300) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(okJson({ suggestions: [SUGGESTION, SUGGESTION_2] }));
  vi.stubGlobal('fetch', fetchMock);
  onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PartyAutocomplete — debounce и минимальная длина', () => {
  it('меньше 2 значимых символов → fetch не зовётся вовсе', async () => {
    await typeAndSettle('р', 1000);
    await typeAndSettle('  р  ', 1000); // trim: значимый символ один
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('быстрый ввод трёх значений → один fetch с последним запросом после 300мс', async () => {
    fireEvent.change(input(), { target: { value: 'ро' } });
    fireEvent.change(input(), { target: { value: 'ром' } });
    fireEvent.change(input(), { target: { value: 'ромашка' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/suggest/party?query=${encodeURIComponent('ромашка')}`
    );
  });
});

describe('PartyAutocomplete — выпадашка и выбор', () => {
  it('успешный ответ → выпадашка с названием и ИНН/адресом', async () => {
    await typeAndSettle('ромашка');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText('ИНН 7707083893 · г. Москва, ул. Ленина, 1')).toBeTruthy();
    // Без адреса — только ИНН.
    expect(screen.getByText('ИНН 7707083894')).toBeTruthy();
  });

  it('клик (mousedown) по пункту → onSelect с ПОЛНЫМ объектом и закрытие выпадашки', async () => {
    await typeAndSettle('ромашка');
    fireEvent.mouseDown(screen.getByText('ООО Ромашка'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(SUGGESTION);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().value).toBe('ООО Ромашка');
  });

  it('пустой ответ → выпадашки нет', async () => {
    fetchMock.mockResolvedValue(okJson({ suggestions: [] }));
    await typeAndSettle('ромашка');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('не-ok ответ (500) → молча нет выпадашки', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await typeAndSettle('ромашка');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('сетевая ошибка → молча нет выпадашки (деградация до ручного ввода)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await typeAndSettle('ромашка');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().value).toBe('ромашка'); // введённый текст не трогаем
  });

  it('поздний ответ устаревшего запроса отсекается', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    await typeAndSettle('первый'); // fetch №1 в полёте
    await typeAndSettle('второй'); // fetch №2 в полёте
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Свежий (№2) отвечает первым — его и показываем.
    await act(async () => {
      resolvers[1](okJson({ suggestions: [SUGGESTION_2] }));
      await Promise.resolve();
    });
    expect(screen.getByText('ООО Василёк')).toBeTruthy();

    // Устаревший (№1) приходит позже — игнорируется, список не подменяется.
    await act(async () => {
      resolvers[0](okJson({ suggestions: [SUGGESTION] }));
      await Promise.resolve();
    });
    expect(screen.queryByText('ООО Ромашка')).toBeNull();
    expect(screen.getByText('ООО Василёк')).toBeTruthy();
  });
});

describe('PartyAutocomplete — клавиатура', () => {
  it('ArrowDown/ArrowUp ходят по списку с закольцовкой, Enter выбирает активный', async () => {
    await typeAndSettle('ромашка');
    const el = input();

    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(el.getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-0');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(el.getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-1');

    fireEvent.keyDown(el, { key: 'ArrowDown' }); // закольцовка на первый
    expect(el.getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-0');

    fireEvent.keyDown(el, { key: 'ArrowUp' }); // с первого — на последний
    expect(el.getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-1');

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(SUGGESTION_2);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ArrowUp со второго пункта возвращает на первый (обычный шаг вверх)', async () => {
    await typeAndSettle('ромашка');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-0');
  });

  it('без id использует автоматический идентификатор для связи со списком', async () => {
    // Поле может рендериться без явного id — aria-связка listbox всё равно
    // обязана работать (иначе скринридер не свяжет список с полем).
    cleanup();
    render(React.createElement(Harness, { onSelect, noId: true } as never));
    await typeAndSettle('ромашка');
    const list = screen.getByRole('listbox');
    expect(list.id.endsWith('-listbox')).toBe(true);
    expect(input().getAttribute('aria-controls')).toBe(list.id);
  });

  it('сбой сети по устаревшему запросу не трогает актуальную выпадашку', async () => {
    // Первый запрос завис и упадёт позже; второй успел показать список.
    // Ошибка первого не должна закрыть список второго.
    let rejectStale: ((e: unknown) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_r, rej) => {
          rejectStale = rej;
        })
    );
    fireEvent.change(input(), { target: { value: 'ром' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fetchMock.mockResolvedValue(okJson({ suggestions: [SUGGESTION] }));
    await typeAndSettle('ромашка');
    expect(screen.getByRole('listbox')).toBeTruthy();

    await act(async () => {
      rejectStale?.(new Error('late failure'));
    });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('ArrowUp первым нажатием уходит на последний пункт (закольцовка снизу)', async () => {
    await typeAndSettle('ромашка');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-1');
  });

  it('уход фокуса закрывает выпадашку с задержкой; возврат — открывает и отменяет закрытие', async () => {
    // Задержка на blur нужна, чтобы успел отработать клик по пункту. А возврат
    // фокуса должен отменить отложенное закрытие — иначе список исчезнет прямо
    // под руками.
    await typeAndSettle('ромашка');
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.blur(input());
    fireEvent.focus(input()); // вернулись до истечения задержки
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole('listbox')).toBeTruthy(); // закрытие отменено

    fireEvent.blur(input());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('наведение мыши делает пункт активным', async () => {
    await typeAndSettle('ромашка');
    fireEvent.mouseEnter(screen.getAllByRole('option')[1]);
    expect(input().getAttribute('aria-activedescendant')).toBe('pa-listbox-opt-1');
  });

  it('клавиши при закрытом списке не трогают ничего', async () => {
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('ответ с не-массивом suggestions → пустой список, не падение', async () => {
    fetchMock.mockResolvedValue(okJson({ suggestions: 'oops' }));
    await typeAndSettle('ромашка');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter без активного пункта ничего не выбирает (обычный сабмит формы не съеден)', async () => {
    await typeAndSettle('ромашка');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Escape закрывает выпадашку', async () => {
    await typeAndSettle('ромашка');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('PartyAutocomplete — aria', () => {
  it('закрытое состояние: combobox с aria-expanded=false, aria-autocomplete=list, aria-controls', () => {
    const el = input();
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    expect(el.getAttribute('aria-controls')).toBe('pa-listbox');
    expect(el.getAttribute('aria-activedescendant')).toBeNull();
    expect(el.getAttribute('autocomplete')).toBe('off');
  });

  it('открытое состояние: aria-expanded=true, listbox связан по id, пункты role=option', async () => {
    await typeAndSettle('ромашка');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox').id).toBe('pa-listbox');
    const options = screen.getAllByRole('option');
    expect(options[0].id).toBe('pa-listbox-opt-0');
    // Без наведения/стрелок ни один пункт не активен.
    expect(options.every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  });
});
