// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  sendDialogMessageAction: vi.fn(),
  bindDialogAction: vi.fn(),
  setDialogStatusAction: vi.fn(),
  startDialogAction: vi.fn(),
}));
vi.mock('@/server-actions/messengers', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { DialogReplyForm } from '@/components/manager/messengers/dialog-reply-form';
import { DialogBindForm } from '@/components/manager/messengers/dialog-bind-form';
import { DialogStatusButton } from '@/components/manager/messengers/dialog-status-button';
import { NewDialogButton } from '@/components/manager/messengers/new-dialog-button';
import type { DialogCandidate } from '@/lib/services/messengers/start';

/**
 * Интерактив диалога (спека 2026-09-12 §5.1–5.2): ответ, привязка, состояние,
 * «Новый диалог». Server-actions замоканы — проверяется, с чем их зовут и что
 * видит человек.
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

describe('DialogReplyForm', () => {
  it('отправляет текст, показывает тост, чистит форму и перечитывает страницу', async () => {
    actions.sendDialogMessageAction.mockResolvedValue({ ok: true, messageId: 'mm1' });
    render(<DialogReplyForm dialogId="d1" />);
    const textarea = screen.getByLabelText('Текст сообщения') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'добрый день' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(actions.sendDialogMessageAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        text: 'добрый день',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Сообщение отправлено'));
    await waitFor(() => expect(textarea.value).toBe(''));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('отказ сервиса из общего словаря — русский текст рядом с кнопкой', async () => {
    actions.sendDialogMessageAction.mockResolvedValue({ ok: false, error: 'channel_unavailable' });
    render(<DialogReplyForm dialogId="d1" />);
    fireEvent.change(screen.getByLabelText('Текст сообщения'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('не подключён'));
  });

  it('форма без поля текста отправляет пустую строку, а не «null»', async () => {
    actions.sendDialogMessageAction.mockResolvedValue({ ok: false, error: 'invalid' });
    render(<DialogReplyForm dialogId="d1" />);
    const textarea = screen.getByLabelText('Текст сообщения');
    textarea.removeAttribute('name');
    textarea.removeAttribute('required');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(actions.sendDialogMessageAction).toHaveBeenCalledWith({ dialogId: 'd1', text: '' })
    );
  });

  it('контекстный код переводится картой формы', async () => {
    actions.sendDialogMessageAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<DialogReplyForm dialogId="d1" />);
    fireEvent.change(screen.getByLabelText('Текст сообщения'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Диалог не найден.'));
  });
});

describe('DialogBindForm', () => {
  const ORGS = [
    { id: 'o1', name: 'Ромашка' },
    { id: 'o2', name: 'Лютик' },
  ] as never;

  it('без организаций — подсказка вместо формы', () => {
    render(<DialogBindForm dialogId="d1" organizations={[] as never} />);
    expect(screen.getByText('Нет доступных организаций для привязки.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('кнопка заблокирована до выбора; успех → action, тост, сброс', async () => {
    actions.bindDialogAction.mockResolvedValue({ ok: true });
    render(<DialogBindForm dialogId="d1" organizations={ORGS} />);
    const button = screen.getByRole('button', { name: 'Привязать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const select = screen.getByLabelText('Организация') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'o2' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(actions.bindDialogAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        organizationId: 'o2',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Диалог привязан'));
    await waitFor(() => expect(select.value).toBe(''));
  });

  it('поле без имени → пустой organizationId, а не «null»', async () => {
    actions.bindDialogAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<DialogBindForm dialogId="d1" organizations={ORGS} />);
    const select = screen.getByLabelText('Организация');
    fireEvent.change(select, { target: { value: 'o1' } });
    select.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await waitFor(() =>
      expect(actions.bindDialogAction).toHaveBeenCalledWith({ dialogId: 'd1', organizationId: '' })
    );
  });

  it('forbidden → контекстный текст', async () => {
    actions.bindDialogAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<DialogBindForm dialogId="d1" organizations={ORGS} />);
    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Организация вне вашей зоны видимости.')
    );
  });
});

describe('DialogStatusButton', () => {
  it('открытый диалог закрывается, закрытый — открывается снова', async () => {
    actions.setDialogStatusAction.mockResolvedValue({ ok: true, changed: true });
    render(<DialogStatusButton dialogId="d1" status="open" />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть диалог' }));
    await waitFor(() =>
      expect(actions.setDialogStatusAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        status: 'closed',
      })
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Диалог закрыт'));

    render(<DialogStatusButton dialogId="d1" status="closed" />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть снова' }));
    await waitFor(() =>
      expect(actions.setDialogStatusAction).toHaveBeenLastCalledWith({
        dialogId: 'd1',
        status: 'open',
      })
    );
  });

  it('отказ — тост с контекстным текстом', async () => {
    actions.setDialogStatusAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<DialogStatusButton dialogId="d1" status="open" />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть диалог' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Диалог не найден'));
  });
});

describe('NewDialogButton', () => {
  const candidates: DialogCandidate[] = [
    { kind: 'user', id: 'u1', name: 'Иван', organizationName: 'Ромашка', channels: ['telegram'] },
    {
      kind: 'contact',
      id: 'k1',
      name: 'Пётр',
      organizationName: null,
      channels: ['max', 'whatsapp'],
    },
  ];

  it('без кандидатов — объяснение, откуда берутся адреса', () => {
    render(<NewDialogButton candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    expect(screen.getByText(/Пока некому написать первым/).textContent).toContain(
      'привязывает бота'
    );
    expect(screen.queryByLabelText('Кому')).toBeNull();
  });

  it('один мессенджер выбирается сам; успех ведёт в диалог', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: true, dialogId: 'd9' });
    render(<NewDialogButton candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    const person = screen.getByLabelText('Кому') as HTMLSelectElement;
    expect(person.options[1]?.textContent).toBe('Иван — Ромашка');
    expect(person.options[2]?.textContent).toBe('Пётр');
    fireEvent.change(person, { target: { value: 'user:u1' } });
    const channel = screen.getByLabelText('Мессенджер') as HTMLSelectElement;
    expect(channel.value).toBe('telegram');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диалог' }));
    await waitFor(() =>
      expect(actions.startDialogAction).toHaveBeenCalledWith({
        kind: 'user',
        id: 'u1',
        channel: 'telegram',
      })
    );
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/manager/messengers/d9'));
  });

  it('два мессенджера — надо выбрать; без выбора — подсказка; отказ сервиса — текст', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: false, error: 'no_messenger_channel' });
    render(<NewDialogButton candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диалог' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Выберите, кому и в каком мессенджере'
      )
    );
    const person = screen.getByLabelText('Кому') as HTMLSelectElement;
    fireEvent.change(person, { target: { value: 'contact:k1' } });
    const channel = screen.getByLabelText('Мессенджер') as HTMLSelectElement;
    expect(channel.value).toBe('');
    expect(Array.from(channel.options).map((o) => o.textContent)).toEqual([
      'Выберите мессенджер…',
      'MAX',
      'WhatsApp',
    ]);
    fireEvent.change(channel, { target: { value: 'whatsapp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диалог' }));
    await waitFor(() =>
      expect(actions.startDialogAction).toHaveBeenCalledWith({
        kind: 'contact',
        id: 'k1',
        channel: 'whatsapp',
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('нет привязанного мессенджера')
    );
    expect(nav.push).not.toHaveBeenCalled();

    // «Отмена» закрывает окно и стирает ошибку.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
  });

  // Этап 1 ТЗ 12.09.2026 (`У-179`, спека §3.12): «Написать» из карточки контакта
  // ведёт сюда с `?new=<contactId>` — окно открыто сразу, человек уже выбран.
  it('preselect: окно открыто без клика, контакт выбран; два мессенджера — канал ещё не выбран', () => {
    render(<NewDialogButton candidates={candidates} preselect="k1" />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('contact:k1');
    expect((screen.getByLabelText('Мессенджер') as HTMLSelectElement).value).toBe('');
  });

  it('preselect с одним мессенджером — канал выбран сам', () => {
    const one: DialogCandidate[] = [
      ...candidates,
      { kind: 'contact', id: 'k2', name: 'Ольга', organizationName: null, channels: ['telegram'] },
    ];
    render(<NewDialogButton candidates={one} preselect="k2" />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('contact:k2');
    expect((screen.getByLabelText('Мессенджер') as HTMLSelectElement).value).toBe('telegram');
  });

  it('preselect с неизвестным id (или id пользователя, а не контакта) — окно открыто, форма пустая', () => {
    // «u1» есть среди кандидатов, но это пользователь кабинета — предвыбор только для контактов.
    render(<NewDialogButton candidates={candidates} preselect="u1" />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Мессенджер') as HTMLSelectElement).value).toBe('');
  });
});
