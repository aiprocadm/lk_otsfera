// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));

const { useStaffChatPolling } = vi.hoisted(() => ({ useStaffChatPolling: vi.fn() }));
vi.mock('@/hooks/useStaffChatPolling', () => ({ useStaffChatPolling }));

import { StaffUnreadBadge } from '@/components/staff-chat/staff-unread-badge';
import {
  StaffConversationList,
  type StaffConversationRowVM,
  type StaffColleagueVM
} from '@/components/staff-chat/staff-conversation-list';
import { StaffThreadView, type StaffThreadMessageVM } from '@/components/staff-chat/staff-thread-view';
import { StaffComposer } from '@/components/staff-chat/staff-composer';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';
import type { StaffPolledRow } from '@/hooks/useStaffChatPolling';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// StaffUnreadBadge
// ===========================================================================

describe('StaffUnreadBadge', () => {
  beforeEach(() => {
    useClientResource.mockReset();
  });

  it('renders nothing when count is 0', () => {
    useClientResource.mockReturnValue({ data: 0 });
    const { container } = render(React.createElement(StaffUnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is null/undefined', () => {
    useClientResource.mockReturnValue({ data: null });
    const { container } = render(React.createElement(StaffUnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is negative', () => {
    useClientResource.mockReturnValue({ data: -3 });
    const { container } = render(React.createElement(StaffUnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders the badge with the count when positive', () => {
    useClientResource.mockReturnValue({ data: 4 });
    render(React.createElement(StaffUnreadBadge));
    const badge = screen.getByLabelText('Непрочитанные сообщения команды');
    expect(badge.textContent).toBe('4');
  });

  it('reads /api/staff-chat/unread with a select() defaulting to 0', () => {
    let capturedUrl: string | undefined;
    let capturedSelect: ((d: unknown) => number) | undefined;
    useClientResource.mockImplementation((url: string, opts: { select: (d: unknown) => number }) => {
      capturedUrl = url;
      capturedSelect = opts.select;
      return { data: 0 };
    });
    render(React.createElement(StaffUnreadBadge));
    expect(capturedUrl).toBe('/api/staff-chat/unread');
    expect(capturedSelect!({})).toBe(0);
    expect(capturedSelect!({ count: 6 })).toBe(6);
  });
});

// ===========================================================================
// StaffConversationList
// ===========================================================================

describe('StaffConversationList', () => {
  const ROWS: StaffConversationRowVM[] = [
    {
      id: 'g1',
      kind: 'general',
      title: '# Общий',
      companyName: 'Промтехносфера',
      lastMessageAt: '2024-01-01T10:00:00Z',
      unread: false
    },
    { id: 'dm1', kind: 'dm', title: 'Иван Иванов', companyName: null, lastMessageAt: '2024-01-02T10:00:00Z', unread: true },
    { id: 'dm2', kind: 'dm', title: 'Пётр Петров', companyName: null, lastMessageAt: '2024-01-03T10:00:00Z', unread: false }
  ];
  const COLLEAGUES: StaffColleagueVM[] = [
    { id: 'u2', name: 'Иван Иванов' },
    { id: 'u3', name: 'Пётр Петров' }
  ];

  it('orders general(s) first, then DMs by lastMessageAt desc', () => {
    render(
      <StaffConversationList rows={ROWS} activeId={null} onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={COLLEAGUES} />
    );
    const rowButtons = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-active'));
    expect(rowButtons.length).toBe(3);
    expect(rowButtons[0].textContent).toContain('# Общий');
    expect(rowButtons[0].textContent).toContain('Промтехносфера');
    expect(rowButtons[1].textContent).toContain('Пётр Петров');
    expect(rowButtons[2].textContent).toContain('Иван Иванов');
  });

  it('marks only the active row with data-active="true"', () => {
    render(
      <StaffConversationList rows={ROWS} activeId="dm1" onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={COLLEAGUES} />
    );
    const active = screen.getAllByRole('button').filter((b) => b.getAttribute('data-active') === 'true');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain('Иван Иванов');
  });

  it('shows the unread dot only for unread rows', () => {
    render(
      <StaffConversationList rows={ROWS} activeId={null} onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={COLLEAGUES} />
    );
    expect(screen.getAllByLabelText('Непрочитано').length).toBe(1);
  });

  it('clicking a row calls onSelect with its id', () => {
    const onSelect = vi.fn();
    render(
      <StaffConversationList rows={ROWS} activeId={null} onSelect={onSelect} onNewDm={vi.fn()} colleagues={COLLEAGUES} />
    );
    fireEvent.click(screen.getByText('Пётр Петров'));
    expect(onSelect).toHaveBeenCalledWith('dm2');
  });

  it('shows "Нет бесед" when rows is empty', () => {
    render(<StaffConversationList rows={[]} activeId={null} onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={[]} />);
    expect(screen.getByText('Нет бесед')).toBeTruthy();
  });

  it('does not render a companyName suffix for a general row without one', () => {
    const rows: StaffConversationRowVM[] = [
      { id: 'g2', kind: 'general', title: '# Общий', companyName: null, lastMessageAt: '2024-01-01T10:00:00Z', unread: false }
    ];
    render(<StaffConversationList rows={rows} activeId={null} onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={[]} />);
    expect(screen.queryByText('Промтехносфера')).toBeNull();
  });

  it('picker: toggling opens the colleague list; picking a colleague calls onNewDm and closes the picker', () => {
    const onNewDm = vi.fn();
    render(
      <StaffConversationList rows={ROWS} activeId={null} onSelect={vi.fn()} onNewDm={onNewDm} colleagues={COLLEAGUES} />
    );
    // Closed by default: only the row's <span> shows "Иван Иванов" (the row is
    // unread, so its button's *accessible name* also includes the "Непрочитано"
    // dot label — matching on plain text sidesteps that instead of role+name).
    expect(screen.getAllByText('Иван Иванов').length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    const matches = screen.getAllByText('Иван Иванов');
    expect(matches.length).toBe(2);
    const pickerButton = matches.find((el) => el.tagName === 'BUTTON') as HTMLElement;
    fireEvent.click(pickerButton);

    expect(onNewDm).toHaveBeenCalledWith('u2');
    // picker closed after pick
    expect(screen.getAllByText('Иван Иванов').length).toBe(1);
  });

  it('picker shows "Нет доступных коллег" when colleagues is empty', () => {
    render(<StaffConversationList rows={ROWS} activeId={null} onSelect={vi.fn()} onNewDm={vi.fn()} colleagues={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    expect(screen.getByText('Нет доступных коллег')).toBeTruthy();
  });
});

// ===========================================================================
// StaffThreadView
// ===========================================================================

function makeMsg(overrides: Partial<StaffThreadMessageVM> & { id: string }): StaffThreadMessageVM {
  return {
    authorId: 'me',
    authorName: 'Я',
    body: 'текст',
    hasAttachment: false,
    attachmentName: null,
    scanStatus: 'none',
    createdAt: '2024-01-01T09:00:00Z',
    reactions: [],
    ...overrides
  };
}

describe('StaffThreadView', () => {
  it('renders "Сообщений пока нет" when there are no messages', () => {
    render(<StaffThreadView messages={[]} currentUserId="me" onToggleReaction={vi.fn()} />);
    expect(screen.getByText('Сообщений пока нет')).toBeTruthy();
  });

  it('aligns own messages (data-mine=true, no author label) vs others (data-mine=false, author shown)', () => {
    const mine = makeMsg({ id: 'm1', authorId: 'me', authorName: 'Я', body: 'моё' });
    const other = makeMsg({ id: 'm2', authorId: 'colleague', authorName: 'Коллега', body: 'чужое' });
    render(<StaffThreadView messages={[mine, other]} currentUserId="me" onToggleReaction={vi.fn()} />);

    const mineEl = screen.getByText('моё').closest('[data-mine]');
    expect(mineEl?.getAttribute('data-mine')).toBe('true');
    const otherEl = screen.getByText('чужое').closest('[data-mine]');
    expect(otherEl?.getAttribute('data-mine')).toBe('false');
    expect(screen.queryByText('Я')).toBeNull();
    expect(screen.getByText('Коллега')).toBeTruthy();
  });

  it('renders one date separator per day and repeats it for a later day', () => {
    const rows = [
      makeMsg({ id: 'm1', createdAt: '2024-01-01T09:00:00Z' }),
      makeMsg({ id: 'm2', authorId: 'colleague', authorName: 'Коллега', createdAt: '2024-01-01T10:00:00Z' }),
      makeMsg({ id: 'm3', createdAt: '2024-01-02T09:00:00Z' })
    ];
    render(<StaffThreadView messages={rows} currentUserId="me" onToggleReaction={vi.fn()} />);
    expect(screen.getAllByText('01.01.2024').length).toBe(1);
    expect(screen.getByText('02.01.2024')).toBeTruthy();
  });

  it('skips the date separator gracefully for an unparseable createdAt (defensive branch)', () => {
    const rows = [makeMsg({ id: 'm1', createdAt: 'not-a-date', body: 'битая дата' })];
    render(<StaffThreadView messages={rows} currentUserId="me" onToggleReaction={vi.fn()} />);
    expect(screen.getByText('битая дата')).toBeTruthy();
  });

  it('renders all 5 fixed reaction chips, shows counts, highlights mine, and fires onToggleReaction on click', () => {
    const onToggleReaction = vi.fn();
    const msg = makeMsg({
      id: 'r1',
      reactions: [
        { emoji: '👍', count: 3, mine: true },
        { emoji: '🔥', count: 1, mine: false }
      ]
    });
    render(<StaffThreadView messages={[msg]} currentUserId="me" onToggleReaction={onToggleReaction} />);

    const thumbsUp = screen.getByRole('button', { name: 'Реакция 👍' });
    expect(thumbsUp.getAttribute('data-mine')).toBe('true');
    expect(thumbsUp.getAttribute('aria-pressed')).toBe('true');
    expect(thumbsUp.textContent).toContain('3');

    const fire = screen.getByRole('button', { name: 'Реакция 🔥' });
    expect(fire.getAttribute('data-mine')).toBe('false');
    expect(fire.textContent).toContain('1');

    const question = screen.getByRole('button', { name: 'Реакция ❓' });
    expect(question.getAttribute('data-mine')).toBe('false');
    expect(question.textContent).not.toMatch(/\d/);

    fireEvent.click(thumbsUp);
    expect(onToggleReaction).toHaveBeenCalledWith('r1', '👍');
  });

  it('renders attachment states: pending, infected, clean-with-name, clean-without-name, and none', () => {
    const rows = [
      makeMsg({ id: 'p1', hasAttachment: true, scanStatus: 'pending', attachmentName: 'doc.pdf' }),
      makeMsg({ id: 'i1', hasAttachment: true, scanStatus: 'infected', attachmentName: 'bad.exe' }),
      makeMsg({ id: 'c1', hasAttachment: true, scanStatus: 'clean', attachmentName: 'report.xlsx' }),
      makeMsg({ id: 'c2', hasAttachment: true, scanStatus: 'clean', attachmentName: null }),
      makeMsg({ id: 'n1', hasAttachment: false, scanStatus: 'none', attachmentName: null })
    ];
    render(<StaffThreadView messages={rows} currentUserId="me" onToggleReaction={vi.fn()} />);

    expect(screen.getByText('⏳ проверяется')).toBeTruthy();
    expect(screen.getByText('⛔ файл заражён')).toBeTruthy();

    const link = screen.getByRole('link', { name: /report\.xlsx/ });
    expect(link.getAttribute('href')).toBe('/api/staff-chat/attachment?messageId=c1');
    expect(link.getAttribute('target')).toBe('_blank');

    expect(screen.getByRole('link', { name: /вложение/ })).toBeTruthy();
  });

  it('does not crash when scrollIntoView is unimplemented (default jsdom)', () => {
    // jsdom doesn't implement scrollIntoView by default — every other test in
    // this suite already exercises this (false) branch implicitly; this test
    // documents the invariant explicitly.
    expect(() =>
      render(<StaffThreadView messages={[makeMsg({ id: 'm1' })]} currentUserId="me" onToggleReaction={vi.fn()} />)
    ).not.toThrow();
  });

  it('calls scrollIntoView on the bottom sentinel when the browser supports it', () => {
    const scrollSpy = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: (arg: unknown) => void }).scrollIntoView = scrollSpy;
    try {
      render(<StaffThreadView messages={[makeMsg({ id: 'm1' })]} currentUserId="me" onToggleReaction={vi.fn()} />);
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'end' });
    } finally {
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

// ===========================================================================
// StaffComposer
// ===========================================================================

describe('StaffComposer', () => {
  const COLLEAGUES: StaffColleagueVM[] = [
    { id: 'u2', name: 'Иван Иванов' },
    { id: 'u3', name: 'Игорь Петров' }
  ];

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // The network-error upload test below deliberately logs via clientLog.warn
    // (a console.warn wrapper) — expected noise, not a failure.
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('submit button is disabled while the textarea is empty', () => {
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter submits the trimmed body (no attachment) and clears the textarea', () => {
    const onSend = vi.fn();
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={onSend} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  привет  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('привет', null);
    expect(textarea.value).toBe('');
  });

  it('Shift+Enter does not submit', () => {
    const onSend = vi.fn();
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={onSend} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'многострочный' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('submitting whitespace-only text via form submit does not call onSend', () => {
    const onSend = vi.fn();
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={onSend} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    const form = textarea.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('@-autocomplete filters colleagues by the token after @ and inserts "@Name " on click', () => {
    render(<StaffComposer conversationId="c1" colleagues={COLLEAGUES} onSend={vi.fn()} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Привет, @Ив' } });

    expect(screen.getByRole('button', { name: '@Иван Иванов' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '@Игорь Петров' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '@Иван Иванов' }));
    expect(textarea.value).toBe('Привет, @Иван Иванов ');
    expect(screen.queryByRole('button', { name: '@Иван Иванов' })).toBeNull();
  });

  it('shows no dropdown when there is no @ in the text', () => {
    render(<StaffComposer conversationId="c1" colleagues={COLLEAGUES} onSend={vi.fn()} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'просто текст' } });
    expect(screen.queryByRole('button', { name: /^@/ })).toBeNull();
  });

  it('shows no dropdown when no colleague matches the token', () => {
    render(<StaffComposer conversationId="c1" colleagues={COLLEAGUES} onSend={vi.fn()} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@zzz' } });
    expect(screen.queryByRole('button', { name: /^@/ })).toBeNull();
  });

  it('closes the dropdown once whitespace follows the @-token', () => {
    render(<StaffComposer conversationId="c1" colleagues={COLLEAGUES} onSend={vi.fn()} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@Ив' } });
    expect(screen.getByRole('button', { name: '@Иван Иванов' })).toBeTruthy();
    fireEvent.change(textarea, { target: { value: '@Ив ' } });
    expect(screen.queryByRole('button', { name: '@Иван Иванов' })).toBeNull();
  });

  it('insertMention is a no-op if the caret is repositioned before the @ (stale mention state)', () => {
    render(<StaffComposer conversationId="c1" colleagues={COLLEAGUES} onSend={vi.fn()} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@Ив' } });
    const pick = screen.getByRole('button', { name: '@Иван Иванов' });
    textarea.setSelectionRange(0, 0);
    fireEvent.click(pick);
    expect(textarea.value).toBe('@Ив');
  });

  it('attaching a file uploads it, shows a removable chip, and the send includes the attachment fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, attachmentPath: 'staff-chat/c1/x-doc.pdf' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSend = vi.fn();
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={onSend} />);

    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText('📎 doc.pdf')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/staff-chat/attachment', expect.objectContaining({ method: 'POST' }));

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'вот файл' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onSend).toHaveBeenCalledWith('вот файл', {
      path: 'staff-chat/c1/x-doc.pdf',
      name: 'doc.pdf',
      mime: 'application/pdf'
    });
    expect(screen.queryByText('📎 doc.pdf')).toBeNull();
  });

  it('the ✕ button removes the staged attachment chip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, attachmentPath: 'p' }) })
    );
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText('📎 a.png')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Убрать вложение'));
    expect(screen.queryByText('📎 a.png')).toBeNull();
  });

  it('file input change with no file selected does not trigger an upload', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [] });
    fireEvent.change(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a mapped RU toast when the upload fails with a known error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: 'too_large' }) })
    );
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Файл превышает допустимый размер.'));
  });

  it('falls back to a generic message for an unmapped upload error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: 'conversation_not_found' }) })
    );
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось загрузить файл.'));
  });

  it('falls back to a generic message when the response JSON cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        }
      })
    );
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось загрузить файл.'));
  });

  it('shows a network-error toast when the upload request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={vi.fn()} />);
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Сетевая ошибка. Проверьте соединение и попробуйте снова.')
    );
  });

  it('disables the submit button and file input while an upload is in flight, then re-enables', async () => {
    let resolveFetch!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((res) => {
            resolveFetch = res;
          })
      )
    );
    const onSend = vi.fn();
    render(<StaffComposer conversationId="c1" colleagues={[]} onSend={onSend} />);
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'текст' } });
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(input.disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);

    // Enter is a no-op while uploading (uploading guard inside submit()).
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ ok: true, attachmentPath: 'p' }) });
      await Promise.resolve();
    });
    await waitFor(() => expect(input.disabled).toBe(false));
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ===========================================================================
// StaffChatSection (glue)
// ===========================================================================

describe('StaffChatSection', () => {
  const CONVERSATIONS: StaffConversationRowVM[] = [
    { id: 'g1', kind: 'general', title: '# Общий', companyName: null, lastMessageAt: '2024-01-01T10:00:00Z', unread: false },
    // Deliberately distinct from the colleague name below — a DM row titled the
    // same as a colleague would make the "+ Новое сообщение" picker button
    // ambiguous to query by role+name.
    { id: 'dm1', kind: 'dm', title: 'Иван Смирнов', companyName: null, lastMessageAt: '2024-01-02T10:00:00Z', unread: false }
  ];
  const COLLEAGUES_RAW: StaffColleagueVM[] = [
    { id: 'me', name: 'Я' },
    { id: 'u2', name: 'Коллега' }
  ];

  let refetchConversations: ReturnType<typeof vi.fn>;
  let capturedOnNew: ((rows: StaffPolledRow[]) => void) | undefined;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    refetchConversations = vi.fn();
    capturedOnNew = undefined;
    useClientResource.mockReset();
    useClientResource.mockImplementation((url: string) => {
      if (url === '/api/staff-chat/conversations') {
        return { data: CONVERSATIONS, refetch: refetchConversations };
      }
      if (url === '/api/staff-chat/colleagues') {
        return { data: COLLEAGUES_RAW, refetch: vi.fn() };
      }
      return { data: null, refetch: vi.fn() };
    });
    useStaffChatPolling.mockReset();
    useStaffChatPolling.mockImplementation((_conversationId: string | null, _latest: string | null, onNew: (rows: StaffPolledRow[]) => void) => {
      capturedOnNew = onNew;
    });
    toastError.mockClear();
    // Several tests below deliberately exercise error paths that log via
    // clientLog.warn (a console.warn wrapper) — expected noise, not failures.
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  function messagesResponse(rows: StaffThreadMessageVM[]) {
    return { ok: true, json: async () => ({ ok: true, rows }) };
  }

  it('shows "Выберите беседу" before any conversation is selected', () => {
    render(<StaffChatSection currentUserId="me" />);
    expect(screen.getByText('Выберите беседу')).toBeTruthy();
  });

  it('filters the current user out of the colleague picker/mention list', () => {
    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    expect(screen.queryByRole('button', { name: 'Я' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Коллега' })).toBeTruthy();
  });

  it('defaults conversations/colleagues to [] while useClientResource has not resolved data yet', () => {
    useClientResource.mockImplementation(() => ({ data: null, refetch: vi.fn() }));
    render(<StaffChatSection currentUserId="me" />);
    expect(screen.getByText('Нет бесед')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    expect(screen.getByText('Нет доступных коллег')).toBeTruthy();
  });

  it('passes select() mappers to useClientResource that default missing rows to []', () => {
    const captured: Record<string, (raw: unknown) => unknown> = {};
    useClientResource.mockImplementation((url: string, opts: { select: (raw: unknown) => unknown }) => {
      captured[url] = opts.select;
      if (url === '/api/staff-chat/conversations') return { data: CONVERSATIONS, refetch: refetchConversations };
      if (url === '/api/staff-chat/colleagues') return { data: COLLEAGUES_RAW, refetch: vi.fn() };
      return { data: null, refetch: vi.fn() };
    });

    render(<StaffChatSection currentUserId="me" />);

    expect(captured['/api/staff-chat/conversations']({})).toEqual([]);
    expect(captured['/api/staff-chat/conversations']({ rows: CONVERSATIONS })).toEqual(CONVERSATIONS);
    expect(captured['/api/staff-chat/colleagues']({})).toEqual([]);
    expect(captured['/api/staff-chat/colleagues']({ rows: COLLEAGUES_RAW })).toEqual(COLLEAGUES_RAW);
  });

  it('selecting a conversation loads its messages, marks it read, and refetches conversations on success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?conversationId=g1')) {
        return Promise.resolve(
          messagesResponse([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега', body: 'привет' })])
        );
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url + JSON.stringify(init));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));

    await waitFor(() => expect(screen.getByText('привет')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff-chat/read',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ conversationId: 'g1' }) })
    );
    await waitFor(() => expect(refetchConversations).toHaveBeenCalled());
  });

  it('loadMessages: a non-ok response clears messages (empty state) without throwing', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());
  });

  it('loadMessages: a network error clears messages without throwing', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.reject(new Error('down'));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());
  });

  it('markRead: a network error is swallowed without throwing (no conversations refetch)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.reject(new Error('down'));
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());
    expect(refetchConversations).not.toHaveBeenCalled();
  });

  it('sending a message posts it, then refetches messages and conversations', async () => {
    let sendBody: string | undefined;
    let messagesCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        messagesCallCount += 1;
        if (messagesCallCount === 1) return Promise.resolve(messagesResponse([]));
        return Promise.resolve(
          messagesResponse([makeMsg({ id: 'm1', authorId: 'me', authorName: 'Я', body: 'новое' })])
        );
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/messages' && init?.method === 'POST') {
        sendBody = init.body as string;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, messageId: 'm1' }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'новое' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('новое')).toBeTruthy());
    expect(JSON.parse(sendBody!)).toMatchObject({ conversationId: 'g1', body: 'новое' });
    expect(refetchConversations).toHaveBeenCalled();
  });

  it('sending a message with a staged attachment includes the attachment fields', async () => {
    let sendBody: string | undefined;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/attachment' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, attachmentPath: 'staff-chat/g1/f.pdf' }) });
      }
      if (url === '/api/staff-chat/messages' && init?.method === 'POST') {
        sendBody = init.body as string;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, messageId: 'm2' }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());

    const fileInput = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    const file = new File(['x'], 'f.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByText('📎 f.pdf')).toBeTruthy());

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'с файлом' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(sendBody).toBeDefined());
    expect(JSON.parse(sendBody!)).toMatchObject({
      conversationId: 'g1',
      body: 'с файлом',
      attachmentPath: 'staff-chat/g1/f.pdf',
      attachmentName: 'f.pdf',
      attachmentMime: 'application/pdf'
    });
  });

  it('sending a message that fails (ok:false) shows a mapped toast and does not refetch messages again', async () => {
    let messagesCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        messagesCallCount += 1;
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/messages' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({ ok: false, error: 'empty_body' }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());
    const callsAfterSelect = messagesCallCount;

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'не пройдёт' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Введите текст сообщения.'));
    expect(messagesCallCount).toBe(callsAfterSelect);
  });

  it('sending a message that fails with no error code in the body falls back to the generic message', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/messages' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({ ok: false }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'без кода ошибки' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось отправить сообщение.'));
  });

  it('sending a message that throws a network error shows a network toast', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/messages' && init?.method === 'POST') {
        return Promise.reject(new Error('down'));
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('Сообщений пока нет')).toBeTruthy());

    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'сеть упала' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Сетевая ошибка. Проверьте соединение и попробуйте снова.')
    );
  });

  it('toggling a reaction posts it and refetches messages on success', async () => {
    let messagesCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        messagesCallCount += 1;
        return Promise.resolve(
          messagesResponse([
            makeMsg({
              id: 'm1',
              authorId: 'u2',
              authorName: 'Коллега',
              reactions: messagesCallCount > 1 ? [{ emoji: '👍', count: 1, mine: true }] : []
            })
          ])
        );
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/reactions' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, reacted: true }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Реакция 👍' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Реакция 👍' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Реакция 👍' }).textContent).toContain('1'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff-chat/reactions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 'm1', emoji: '👍' })
      })
    );
  });

  it('toggling a reaction that fails does not refetch messages (logged, not thrown)', async () => {
    let messagesCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        messagesCallCount += 1;
        return Promise.resolve(messagesResponse([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега' })]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/reactions' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400 });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Реакция 👍' })).toBeTruthy());
    const callsAfterSelect = messagesCallCount;

    fireEvent.click(screen.getByRole('button', { name: 'Реакция 👍' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/staff-chat/reactions', expect.objectContaining({ method: 'POST' }))
    );
    expect(messagesCallCount).toBe(callsAfterSelect);
  });

  it('toggling a reaction that throws a network error does not crash', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(messagesResponse([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега' })]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      if (url === '/api/staff-chat/reactions' && init?.method === 'POST') {
        return Promise.reject(new Error('down'));
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Реакция 👍' })).toBeTruthy());

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Реакция 👍' }))).not.toThrow();
  });

  it('starting a new DM posts it, refetches conversations, and selects the returned conversation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/staff-chat/dm' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, conversationId: 'dm-new' }) });
      }
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?conversationId=dm-new')) {
        return Promise.resolve(messagesResponse([]));
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Коллега' }));

    await waitFor(() => expect(refetchConversations).toHaveBeenCalled());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/staff-chat/read',
        expect.objectContaining({ body: JSON.stringify({ conversationId: 'dm-new' }) })
      )
    );
  });

  it('starting a new DM that fails (ok:false) shows a mapped toast and does not select a conversation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/staff-chat/dm' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({ ok: false, error: 'forbidden' }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Коллега' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(screen.getByText('Выберите беседу')).toBeTruthy();
  });

  it('starting a new DM that fails with no error code in the body falls back to the generic message', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/staff-chat/dm' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({ ok: false }) });
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Коллега' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось открыть диалог.'));
  });

  it('starting a new DM that throws a network error shows a network toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Коллега' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Сетевая ошибка. Проверьте соединение и попробуйте снова.')
    );
  });

  it('appendNew (from useStaffChatPolling) dedups by id and appends fresh rows, marking read again while open', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(
          messagesResponse([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега', body: 'исходное' })])
        );
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('исходное')).toBeTruthy());
    expect(capturedOnNew).toBeDefined();
    const readCallsAfterSelect = fetchMock.mock.calls.filter((c) => c[0] === '/api/staff-chat/read').length;

    act(() => {
      capturedOnNew!([
        makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега', body: 'дубликат' }),
        makeMsg({ id: 'm2', authorId: 'u2', authorName: 'Коллега', body: 'новое сообщение' })
      ]);
    });

    await waitFor(() => expect(screen.getByText('новое сообщение')).toBeTruthy());
    expect(screen.queryByText('дубликат')).toBeNull();
    await waitFor(() => {
      const readCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/staff-chat/read').length;
      expect(readCalls).toBeGreaterThan(readCallsAfterSelect);
    });
  });

  it('appendNew with an all-duplicate batch is a no-op (fresh.length === 0 branch)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/staff-chat/messages?')) {
        return Promise.resolve(
          messagesResponse([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега', body: 'исходное' })])
        );
      }
      if (url === '/api/staff-chat/read') return Promise.resolve({ ok: true });
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByText('# Общий'));
    await waitFor(() => expect(screen.getByText('исходное')).toBeTruthy());

    act(() => {
      capturedOnNew!([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега', body: 'исходное-дубликат' })]);
    });

    expect(screen.queryByText('исходное-дубликат')).toBeNull();
  });

  it('appendNew is a no-op (no markRead call) while no conversation is selected', () => {
    render(<StaffChatSection currentUserId="me" />);
    expect(capturedOnNew).toBeDefined();
    expect(() =>
      act(() => {
        capturedOnNew!([makeMsg({ id: 'm1', authorId: 'u2', authorName: 'Коллега' })]);
      })
    ).not.toThrow();
  });
});
