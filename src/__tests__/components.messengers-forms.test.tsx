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
import type { DialogChannel } from '@/lib/services/messengers/channels';

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
  // Тип канала берём из самого кандидата, а не отдельным импортом: наружу
  // модуль отдаёт `DialogCandidate`, а описание канала — его внутренняя часть.
  type CandidateChannel = DialogCandidate['channels'][number];

  /** Канал, которым можно воспользоваться прямо сейчас. */
  const open = (channel: DialogChannel): CandidateChannel => ({
    channel,
    available: true,
    reason: null,
  });
  /**
   * Канал, который ВИДЕН, но не выбирается, — вместе с объяснением. До `У-216`
   * недоступный канал просто исчезал из списка, и человек не мог понять,
   * почему Telegram есть у одного клиента и нет у другого.
   */
  const blocked = (channel: DialogChannel, reason: string): CandidateChannel => ({
    channel,
    available: false,
    reason,
  });

  const NO_WHATSAPP = 'У контакта не указан номер WhatsApp — добавьте его в карточке контакта.';

  const candidates: DialogCandidate[] = [
    {
      kind: 'user',
      id: 'u1',
      name: 'Иван',
      organizationId: 'o1',
      organizationName: 'Ромашка',
      // Один доступный канал и один закрытый: так проверяется, что автовыбор
      // считает именно ДОСТУПНЫЕ способы, а не все подряд.
      channels: [open('telegram'), blocked('whatsapp', NO_WHATSAPP)],
    },
    {
      kind: 'contact',
      id: 'k1',
      name: 'Пётр',
      organizationId: null,
      organizationName: null,
      channels: [open('max'), open('whatsapp')],
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

  it('пусто при сужении до организации — объяснение другое: у НЕЁ никого нет', () => {
    // Две пустоты лечатся по-разному. «Ни у кого нет адреса» — ждём, пока
    // клиент напишет сам. «У этой организации нет людей» — заводим контакт в
    // её карточке. Один текст на оба случая отправил бы ждать там, где надо
    // действовать.
    render(<NewDialogButton candidates={[]} narrowedToOrg autoOpen />);
    const text = screen.getByText(/У этой организации/).textContent ?? '';
    expect(text).toContain('Добавьте контакт в карточке организации');
    expect(text).not.toContain('привязывает бота');
  });

  it('один доступный способ выбирается сам; успех ведёт в диалог', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: true, dialogId: 'd9' });
    render(<NewDialogButton candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    const person = screen.getByLabelText('Кому') as HTMLSelectElement;
    expect(person.options[1]?.textContent).toBe('Иван — Ромашка');
    expect(person.options[2]?.textContent).toBe('Пётр');
    fireEvent.change(person, { target: { value: 'user:u1' } });
    // У Ивана два канала, но доступен ровно один — значит выбирать нечего.
    const channel = screen.getByLabelText('Как написать') as HTMLSelectElement;
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

  it('два доступных способа — надо выбрать; без выбора — подсказка; отказ сервиса — текст', async () => {
    actions.startDialogAction.mockResolvedValue({ ok: false, error: 'no_messenger_channel' });
    render(<NewDialogButton candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть диалог' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Выберите, кому и как написать')
    );
    const person = screen.getByLabelText('Кому') as HTMLSelectElement;
    fireEvent.change(person, { target: { value: 'contact:k1' } });
    const channel = screen.getByLabelText('Как написать') as HTMLSelectElement;
    expect(channel.value).toBe('');
    expect(Array.from(channel.options).map((o) => o.textContent)).toEqual([
      'Выберите способ связи…',
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
    // `У-216`: у отказа появилась своя подпись. Раньше код `no_messenger_channel`
    // был без строки, и любой отказ выглядел безликим «Не удалось».
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Адрес в этом канале неизвестен')
    );
    expect(nav.push).not.toHaveBeenCalled();

    // «Отмена» закрывает окно и стирает ошибку.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
  });

  it('`У-216`: недоступный способ виден в списке, но не выбирается, и под списком написано почему', () => {
    render(<NewDialogButton candidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }));
    fireEvent.change(screen.getByLabelText('Кому'), { target: { value: 'user:u1' } });
    const channel = screen.getByLabelText('Как написать') as HTMLSelectElement;
    const whatsapp = Array.from(channel.options).find((o) => o.value === 'whatsapp')!;
    // Пункт есть — значит человек видит, что такой способ вообще бывает.
    expect(whatsapp.textContent).toBe('WhatsApp — недоступно');
    expect(whatsapp.disabled).toBe(true);
    // Часть способов доступна, поэтому заголовок мягкий, а причина — одна.
    expect(screen.getByText('Почему часть способов недоступна:')).toBeTruthy();
    expect(screen.getByText(NO_WHATSAPP)).toBeTruthy();
  });

  // Этап 1 ТЗ 12.09.2026 (`У-179`, спека §3.12): «Написать» из карточки контакта
  // ведёт сюда с `?new=<contactId>` — окно открыто сразу, человек уже выбран.
  it('autoOpen + preselect: окно открыто без клика, контакт выбран; два способа — выбор за человеком', () => {
    render(<NewDialogButton candidates={candidates} preselect="k1" autoOpen />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('contact:k1');
    expect((screen.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('');
  });

  it('preselect с одним доступным способом — он выбран сам', () => {
    const one: DialogCandidate[] = [
      ...candidates,
      {
        kind: 'contact',
        id: 'k2',
        name: 'Ольга',
        organizationId: null,
        organizationName: null,
        channels: [open('telegram'), blocked('whatsapp', NO_WHATSAPP)],
      },
    ];
    render(<NewDialogButton candidates={one} preselect="k2" autoOpen />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('contact:k2');
    expect((screen.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('telegram');
  });

  it('preselect без autoOpen окно не открывает — это две разные вещи', () => {
    // Разделение появилось из-за прихода с карточки организации: открытие окна
    // и предвыбор человека теперь управляются отдельно.
    render(<NewDialogButton candidates={candidates} preselect="k1" />);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('preselect с неизвестным id (или id пользователя, а не контакта) — окно открыто, форма пустая', () => {
    // «u1» есть среди кандидатов, но это пользователь кабинета — предвыбор только для контактов.
    render(<NewDialogButton candidates={candidates} preselect="u1" autoOpen />);
    expect(document.querySelector('dialog[open]')).toBeTruthy();
    expect((screen.getByLabelText('Кому') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Как написать') as HTMLSelectElement).value).toBe('');
  });
});
