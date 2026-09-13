// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { MentionTextarea, type MentionOption } from '@/components/ui/mention-textarea';

/**
 * Поле с подсказкой имён после `@` (этап 1 ТЗ 12.09.2026, `У-183`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.6) — извлечено из композитора
 * чата команды, поведение прежнее: пока каретка стоит внутри `@токена`, над
 * полем список коллег, чьё имя начинается с токена (регистр не важен); выбор
 * подставляет `@Имя ` на место токена и возвращает каретку за ним; внешний
 * сброс текста закрывает список; остальные атрибуты уходят в textarea.
 */
const COLLEAGUES: MentionOption[] = [
  { id: 'u1', name: 'Петров Пётр' },
  { id: 'u2', name: 'Пелагея Иванова' },
  { id: 'u3', name: 'Иван Сидоров' },
];

type HarnessProps = Omit<
  React.ComponentProps<typeof MentionTextarea>,
  'value' | 'onChange' | 'colleagues'
> & {
  initial?: string;
  onChange?: (value: string) => void;
};

/** Управляемая обёртка: держит текст в состоянии и умеет сбросить его снаружи. */
function Harness({ initial = '', onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MentionTextarea
        aria-label="Текст"
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        colleagues={COLLEAGUES}
      />
      <button type="button" onClick={() => setValue('')}>
        сбросить
      </button>
    </>
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText('Текст') as HTMLTextAreaElement;
}

function type(value: string): void {
  fireEvent.change(textarea(), { target: { value } });
}

function suggestions(): string[] {
  const list = screen.queryByRole('listbox', { name: 'Кого упомянуть' });
  return list
    ? within(list)
        .getAllByRole('button')
        .map((b) => b.textContent ?? '')
    : [];
}

beforeEach(() => {
  // Компонент возвращает фокус и каретку в следующем кадре — в тесте кадр наступает сразу.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('MentionTextarea — когда список показан', () => {
  it('`@Пе` → коллеги, чьё имя начинается с «Пе»; регистр не важен', () => {
    render(<Harness />);
    type('Привет, @Пе');
    expect(suggestions()).toEqual(['@Петров Пётр', '@Пелагея Иванова']);
    type('Привет, @пЕ');
    expect(suggestions()).toEqual(['@Петров Пётр', '@Пелагея Иванова']);
  });

  it('один `@` — токен пустой, подходят все', () => {
    render(<Harness />);
    type('@');
    expect(suggestions()).toEqual(['@Петров Пётр', '@Пелагея Иванова', '@Иван Сидоров']);
  });

  it('без `@` перед кареткой списка нет', () => {
    render(<Harness />);
    type('просто текст');
    expect(suggestions()).toEqual([]);
  });

  it('пробел после токена (`@Пе `) — каретка вне упоминания, список закрыт', () => {
    render(<Harness />);
    type('@Пе');
    expect(suggestions()).toHaveLength(2);
    type('@Пе ');
    expect(suggestions()).toEqual([]);
  });

  it('`@` без совпадений — списка нет', () => {
    render(<Harness />);
    type('@zzz');
    expect(suggestions()).toEqual([]);
  });

  it('внешний сброс текста в пустую строку закрывает список', () => {
    render(<Harness />);
    type('@Пе');
    expect(suggestions()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'сбросить' }));
    expect(textarea().value).toBe('');
    expect(suggestions()).toEqual([]);
  });
});

describe('MentionTextarea — выбор подсказки', () => {
  it('клик подставляет `@Имя ` на место токена, зовёт onChange, фокусирует поле и ставит каретку за именем', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type('Привет, @Пе');
    const el = textarea();
    const setSelection = vi.spyOn(el, 'setSelectionRange');
    el.blur();
    expect(document.activeElement).not.toBe(el);

    fireEvent.click(screen.getByRole('button', { name: '@Петров Пётр' }));

    const expected = 'Привет, @Петров Пётр ';
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(el.value).toBe(expected);
    expect(suggestions()).toEqual([]);
    expect(document.activeElement).toBe(el);
    expect(setSelection).toHaveBeenCalledWith(expected.length, expected.length);
  });

  it('каретка в середине токена — хвост после каретки сохраняется', () => {
    render(<Harness />);
    type('@Пе');
    // Каретку переставили сразу за `@`: подстановка идёт на место `@`, «Пе» остаётся хвостом.
    textarea().setSelectionRange(1, 1);
    fireEvent.click(screen.getByRole('button', { name: '@Пелагея Иванова' }));
    expect(textarea().value).toBe('@Пелагея Иванова Пе');
  });

  it('внешний textareaRef используется вместо внутреннего — подстановка работает через него', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Harness textareaRef={ref} />);
    expect(ref.current).toBe(textarea());
    type('@Ив');
    const setSelection = vi.spyOn(ref.current as HTMLTextAreaElement, 'setSelectionRange');
    fireEvent.click(screen.getByRole('button', { name: '@Иван Сидоров' }));
    expect(textarea().value).toBe('@Иван Сидоров ');
    expect(setSelection).toHaveBeenCalledWith(14, 14);
  });
});

describe('MentionTextarea — прокидывание атрибутов', () => {
  it('placeholder, aria-label, rows и style уходят в textarea', () => {
    render(
      <Harness
        placeholder="Напишите…"
        rows={5}
        style={{ resize: 'vertical' }}
        maxLength={4000}
        disabled
      />
    );
    const el = textarea();
    expect(el.getAttribute('placeholder')).toBe('Напишите…');
    expect(el.getAttribute('aria-label')).toBe('Текст');
    expect(el.rows).toBe(5);
    expect(el.style.resize).toBe('vertical');
    expect(el.maxLength).toBe(4000);
    expect(el.disabled).toBe(true);
  });
});
