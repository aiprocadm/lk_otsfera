// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ startDialogAction: vi.fn() }));
vi.mock('@/server-actions/messengers', () => actions);

import { NewDialogButton } from '@/components/manager/messengers/new-dialog-button';
import type { DialogCandidate } from '@/lib/services/messengers/start';

/**
 * «Новый диалог» после `У-216` (этап 3 PR-6).
 *
 * До этого недоступный способ связи просто не показывался: у одного клиента
 * Telegram в списке был, у другого нет — и почему, человек узнать не мог.
 * Теперь способ ВИДЕН, но не выбирается, а под списком стоит причина. Тесты
 * держат именно это: исчезнувший пункт и пропавшая причина — регресс, который
 * ничем другим не ловится (экран при этом «работает»).
 */

beforeAll(() => {
  // Нативный <dialog> в jsdom не умеет showModal — как в остальных тестах примитива Dialog.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => vi.clearAllMocks());

/** Человек, у которого известен только Telegram. */
const ONE_OPEN: DialogCandidate = {
  kind: 'contact',
  id: 'ct-1',
  name: 'Иван Петров',
  organizationId: 'org-1',
  organizationName: 'ООО «Ромашка»',
  channels: [
    { channel: 'telegram', available: true, reason: null },
    {
      channel: 'whatsapp',
      available: false,
      reason: 'У контакта не указан номер WhatsApp — добавьте его в карточке контакта.',
    },
  ],
};

/** Человек, которому сейчас написать нельзя ни одним способом. */
const ALL_BLOCKED: DialogCandidate = {
  kind: 'user',
  id: 'u-1',
  name: 'Пётр Сидоров',
  organizationId: 'org-1',
  organizationName: null,
  channels: [
    {
      channel: 'telegram',
      available: false,
      reason: 'Человек не нажимал «Старт» в нашем боте Telegram — до этого написать ему нельзя.',
    },
    {
      channel: 'email',
      available: false,
      reason: 'Канал не подключён в настройках — обратитесь к администратору.',
    },
  ],
};

/** Человек с двумя рабочими способами — выбирать должен он сам. */
const TWO_OPEN: DialogCandidate = {
  kind: 'contact',
  id: 'ct-2',
  name: 'Анна Кузнецова',
  organizationId: 'org-1',
  organizationName: 'ООО «Ромашка»',
  channels: [
    { channel: 'telegram', available: true, reason: null },
    { channel: 'email', available: true, reason: null },
  ],
};

/** Окно модалки — всегда смонтировано, поэтому скоупим поиск открытым диалогом. */
function modal(): HTMLElement {
  return document.querySelector('dialog[open]') as HTMLElement;
}

function openForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
}

describe('NewDialogButton — когда писать некому', () => {
  it('пустой список кандидатов объясняет, откуда берутся адреса', () => {
    render(<NewDialogButton candidates={[]} />);
    openForm();
    const box = within(modal());
    expect(box.getByText(/Пока некому написать первым/)).toBeTruthy();
    // Формы нет — выбирать нечего, поэтому и полей быть не должно.
    expect(box.queryByLabelText('Кому')).toBeNull();
  });
});

describe('NewDialogButton — недоступный способ виден (У-216)', () => {
  it('стоит в списке с пометкой «— недоступно» и не выбирается', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });

    const options = [
      ...(box.getByLabelText('Как написать') as HTMLSelectElement).querySelectorAll('option'),
    ];
    const whatsapp = options.find((o) => o.value === 'whatsapp')!;
    // Раньше этого пункта в списке не было вовсе — регресс выглядел бы как
    // «у этого клиента WhatsApp почему-то пропал».
    expect(whatsapp.textContent).toBe('WhatsApp — недоступно');
    expect(whatsapp.disabled).toBe(true);
    expect(options.find((o) => o.value === 'telegram')!.disabled).toBe(false);
  });

  it('под списком стоит причина каждого закрытого способа', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });

    expect(box.getByText('Почему часть способов недоступна:')).toBeTruthy();
    expect(box.getByText(/не указан номер WhatsApp/)).toBeTruthy();
  });

  it('до выбора человека причин нет — объяснять пока нечего', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    expect(box.queryByText('Почему часть способов недоступна:')).toBeNull();
    // Список способов пуст и заблокирован: человек ещё не выбран.
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).disabled).toBe(true);
  });

  it('когда закрыты ВСЕ способы — формулировка предупреждает, а не поясняет', () => {
    render(<NewDialogButton candidates={[ALL_BLOCKED]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'user:u-1' } });

    const warning = box.getByText('Написать этому человеку сейчас нельзя:');
    expect(box.queryByText('Почему часть способов недоступна:')).toBeNull();
    // Предупреждение выделено иначе, чем обычная подсказка: это тупик, а не
    // подробность (человеку нужно понять, что дальше — только к клиенту).
    expect(warning.parentElement?.className).toContain('amber');
    expect(box.getByText(/не нажимал «Старт» в нашем боте Telegram/)).toBeTruthy();
    expect(box.getByText(/Канал не подключён в настройках/)).toBeTruthy();
  });
});

describe('NewDialogButton — выбор способа', () => {
  it('единственный доступный способ выбирается сам', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('telegram');
  });

  it('когда доступных два — за человека не решаем', () => {
    render(<NewDialogButton candidates={[TWO_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-2' } });
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('');
  });

  it('когда доступных нет — подставлять нечего', () => {
    render(<NewDialogButton candidates={[ALL_BLOCKED]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'user:u-1' } });
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('');
  });

  it('смена человека сбрасывает ранее выбранный способ', () => {
    render(<NewDialogButton candidates={[ONE_OPEN, TWO_OPEN]} autoOpen />);
    const box = within(modal());
    const who = box.getByLabelText('Кому');
    const how = box.getByLabelText('Как написать') as HTMLSelectElement;

    fireEvent.change(who, { target: { value: 'contact:ct-1' } });
    expect(how.value).toBe('telegram');
    // Иначе остался бы telegram «от прошлого клиента» — и ушёл бы в отправку.
    fireEvent.change(who, { target: { value: 'contact:ct-2' } });
    expect(how.value).toBe('');
  });

  it('в списке людей видно, из какой они организации', () => {
    render(<NewDialogButton candidates={[ONE_OPEN, ALL_BLOCKED]} autoOpen />);
    const box = within(modal());
    const options = [
      ...(box.getByLabelText('Кому') as HTMLSelectElement).querySelectorAll('option'),
    ];
    expect(options.map((o) => o.textContent)).toEqual([
      'Выберите человека…',
      'Иван Петров — ООО «Ромашка»',
      // Организации нет — приписка не появляется (а не «— null»).
      'Пётр Сидоров',
    ]);
  });
});

describe('NewDialogButton — открытие окна (autoOpen)', () => {
  it('без autoOpen окно закрыто, пока не нажали кнопку', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} />);
    expect(document.querySelector('dialog[open]')).toBeNull();
    openForm();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('autoOpen открывает окно сразу — человек пришёл с «Написать первым»', () => {
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('предвыбранный контакт подставлен вместе со своим единственным способом', () => {
    render(<NewDialogButton candidates={[ONE_OPEN, TWO_OPEN]} preselect="ct-1" autoOpen />);
    const box = within(modal());
    expect((box.getByLabelText('Кому') as HTMLSelectElement).value).toBe('contact:ct-1');
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('telegram');
  });

  it('предвыбор мимо списка форму не ломает — она просто пустая', () => {
    // Контакт вне охвата сотрудника в кандидаты не попал: показать пустую
    // форму честнее, чем «выбран кто-то, кого не видно».
    render(<NewDialogButton candidates={[ONE_OPEN]} preselect="ct-999" autoOpen />);
    const box = within(modal());
    expect((box.getByLabelText('Кому') as HTMLSelectElement).value).toBe('');
    expect((box.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('');
  });
});

describe('NewDialogButton — отправка', () => {
  it('без выбранного способа объясняет, чего не хватает, и сервер не зовёт', async () => {
    render(<NewDialogButton candidates={[TWO_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-2' } });
    fireEvent.click(box.getByRole('button', { name: 'Открыть диалог' }));

    await waitFor(() =>
      expect(box.getByRole('alert').textContent).toBe('Выберите, кому и как написать.')
    );
    expect(actions.startDialogAction).not.toHaveBeenCalled();
  });

  it('успех уводит в созданный диалог', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: true, dialogId: 'd-77' });
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });
    fireEvent.click(box.getByRole('button', { name: 'Открыть диалог' }));

    await waitFor(() =>
      expect(actions.startDialogAction).toHaveBeenCalledWith({
        kind: 'contact',
        id: 'ct-1',
        channel: 'telegram',
      })
    );
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/manager/messengers/d-77'));
  });

  it('отказ «адрес неизвестен» подписан по-русски, а не общим «Не удалось»', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: false, error: 'no_messenger_channel' });
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    const box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });
    fireEvent.click(box.getByRole('button', { name: 'Открыть диалог' }));

    await waitFor(() =>
      expect(box.getByRole('alert').textContent).toBe(
        'Адрес в этом канале неизвестен — выберите другой способ связи.'
      )
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('«Отмена» закрывает окно и стирает прежнюю ошибку', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<NewDialogButton candidates={[ONE_OPEN]} autoOpen />);
    let box = within(modal());
    fireEvent.change(box.getByLabelText('Кому'), { target: { value: 'contact:ct-1' } });
    fireEvent.click(box.getByRole('button', { name: 'Открыть диалог' }));
    await waitFor(() => expect(box.getByRole('alert').textContent).toContain('вне вашей зоны'));

    fireEvent.click(box.getByRole('button', { name: 'Отмена' }));
    expect(document.querySelector('dialog[open]')).toBeNull();

    openForm();
    box = within(modal());
    // Старая ошибка не должна встречать человека при новом открытии.
    expect(box.queryByRole('alert')?.textContent ?? '').toBe('');
  });
});
