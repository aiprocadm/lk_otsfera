// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * Свои чаты команды и выбор собеседника (этап 7 ТЗ 13.10.2026, `У-315`):
 * роль рядом с именем и поиск в «+ Новое сообщение»; «+ Новый чат» —
 * название и участники; созданный чат сразу открыт.
 */
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));
vi.mock('@/hooks/useStaffChatPolling', () => ({ useStaffChatPolling: vi.fn() }));

import {
  StaffConversationList,
  type StaffConversationRowVM,
  type StaffColleagueVM,
} from '@/components/staff-chat/staff-conversation-list';
import { StaffNewGroupForm } from '@/components/staff-chat/staff-new-group-form';
import { staffRoleLabel } from '@/components/staff-chat/staff-colleague';
import { StaffChatSection } from '@/components/staff-chat/staff-chat-section';

const ROWS: StaffConversationRowVM[] = [
  {
    id: 'dm1',
    kind: 'dm',
    title: 'Иван',
    companyName: null,
    lastMessageAt: '2026-01-01T10:00:00Z',
    unread: false,
  },
  {
    id: 'grp',
    kind: 'group',
    title: 'Отдел продаж',
    companyName: null,
    lastMessageAt: '2026-01-02T10:00:00Z',
    unread: false,
  },
  {
    id: 'gen',
    kind: 'general',
    title: '# Общий',
    companyName: null,
    lastMessageAt: '2026-01-01T09:00:00Z',
    unread: false,
  },
];
const COLLEAGUES: StaffColleagueVM[] = [
  { id: 'u2', name: 'Анна Петрова', role: 'leader' },
  { id: 'u3', name: 'Борис Иванов', role: 'manager' },
  { id: 'u4', name: 'Админ', role: 'admin' },
  { id: 'u5', name: 'Без роли' },
];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

const list = (onNewGroup = vi.fn(async () => true), onNewDm = vi.fn()) => {
  render(
    <StaffConversationList
      rows={ROWS}
      activeId={null}
      onSelect={vi.fn()}
      onNewDm={onNewDm}
      onNewGroup={onNewGroup}
      colleagues={COLLEAGUES}
    />
  );
  return { onNewGroup, onNewDm };
};

describe('StaffConversationList — свои чаты и выбор собеседника', () => {
  it('порядок: «# Общий» первым, затем свои чаты и личные по свежести', () => {
    list();
    const titles = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => ['# Общий', 'Отдел продаж', 'Иван'].includes(t ?? ''));
    expect(titles).toEqual(['# Общий', 'Отдел продаж', 'Иван']);
  });

  it('«+ Новое сообщение»: роль рядом с именем и поиск по имени', () => {
    const { onNewDm } = list();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    expect(screen.getByText('· Руководитель')).toBeTruthy();
    expect(screen.getByText('· Менеджер')).toBeTruthy();
    expect(screen.getByText('· Администратор')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Найти коллегу'), { target: { value: 'бор' } });
    expect(screen.queryByText('Анна Петрова')).toBeNull();
    fireEvent.click(screen.getByText('Борис Иванов'));
    expect(onNewDm).toHaveBeenCalledWith('u3');
  });

  it('поиск без совпадений — «Никого не нашли»', () => {
    list();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.change(screen.getByLabelText('Найти коллегу'), { target: { value: 'щщщ' } });
    expect(screen.getByText('Никого не нашли')).toBeTruthy();
  });

  it('«+ Новый чат» открывает форму и закрывает выбор собеседника; создан — форма закрывается', async () => {
    const { onNewGroup } = list();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новый чат' }));
    expect(screen.queryByText('· Администратор', { selector: 'span' })).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Новый чат команды' });
    fireEvent.change(within(form).getByLabelText('Название чата'), {
      target: { value: ' Отдел ' },
    });
    fireEvent.click(within(form).getByLabelText(/Анна Петрова/));
    fireEvent.click(within(form).getByRole('button', { name: 'Создать чат' }));
    await waitFor(() => expect(onNewGroup).toHaveBeenCalledWith('Отдел', ['u2']));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Новый чат команды' })).toBeNull()
    );
    // Повторный клик по «+ Новое сообщение» закрывает форму нового чата.
    fireEvent.click(screen.getByRole('button', { name: '+ Новый чат' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новое сообщение' }));
    expect(screen.queryByRole('form', { name: 'Новый чат команды' })).toBeNull();
  });

  it('не создан — форма остаётся открытой', async () => {
    const onNewGroup = vi.fn(async () => false);
    list(onNewGroup);
    fireEvent.click(screen.getByRole('button', { name: '+ Новый чат' }));
    const form = screen.getByRole('form', { name: 'Новый чат команды' });
    fireEvent.change(within(form).getByLabelText('Название чата'), { target: { value: 'X' } });
    fireEvent.click(within(form).getByLabelText(/Борис Иванов/));
    fireEvent.click(within(form).getByRole('button', { name: 'Создать чат' }));
    await waitFor(() => expect(onNewGroup).toHaveBeenCalled());
    expect(screen.getByRole('form', { name: 'Новый чат команды' })).toBeTruthy();
  });

  it('«Отмена» в форме нового чата закрывает её', () => {
    list();
    fireEvent.click(screen.getByRole('button', { name: '+ Новый чат' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('form', { name: 'Новый чат команды' })).toBeNull();
  });

  it('незнакомая роль — подпись как есть', () => {
    expect(staffRoleLabel('auditor')).toBe('auditor');
  });
});

describe('StaffNewGroupForm', () => {
  const form = (onCreate = vi.fn(async () => true), onCancel = vi.fn()) => {
    render(<StaffNewGroupForm colleagues={COLLEAGUES} onCreate={onCreate} onCancel={onCancel} />);
    return { onCreate, onCancel };
  };

  it('без названия и без участников — подсказки, onCreate не зовётся', () => {
    const { onCreate } = form();
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    expect(screen.getByRole('status').textContent).toBe('Назовите чат.');
    fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    expect(screen.getByRole('status').textContent).toBe('Отметьте хотя бы одного коллегу.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('отметка снимается повторным щелчком; поиск сужает список; «Никого не нашли»', async () => {
    const { onCreate } = form();
    fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: 'X' } });
    const anna = screen.getByLabelText(/Анна Петрова/) as HTMLInputElement;
    fireEvent.click(anna);
    fireEvent.click(screen.getByLabelText(/Борис Иванов/));
    fireEvent.click(anna);
    expect(anna.checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Найти коллегу'), { target: { value: 'без' } });
    expect(screen.queryByLabelText(/Борис Иванов/)).toBeNull();
    expect(screen.getByLabelText(/Без роли/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Найти коллегу'), { target: { value: 'щщ' } });
    expect(screen.getByText('Никого не нашли')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('X', ['u3']));
    // Создан — форма очищена.
    await waitFor(() =>
      expect((screen.getByLabelText('Название чата') as HTMLInputElement).value).toBe('')
    );
  });

  it('не создан — выбор сохраняется; «Отмена» зовёт onCancel', async () => {
    const { onCancel } = form(vi.fn(async () => false));
    fireEvent.change(screen.getByLabelText('Название чата'), { target: { value: 'X' } });
    fireEvent.click(screen.getByLabelText(/Анна Петрова/));
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Анна Петрова/) as HTMLInputElement).checked).toBe(true)
    );
    expect((screen.getByLabelText('Название чата') as HTMLInputElement).value).toBe('X');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('StaffChatSection — создание своего чата', () => {
  const refetch = vi.fn();
  beforeEach(() => {
    useClientResource.mockImplementation((url: string) =>
      url === '/api/staff-chat/conversations'
        ? { data: ROWS, refetch }
        : url === '/api/staff-chat/colleagues'
          ? { data: COLLEAGUES, refetch: vi.fn() }
          : { data: null, refetch: vi.fn() }
    );
  });

  const create = () => {
    render(<StaffChatSection currentUserId="me" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Новый чат' }));
    const f = screen.getByRole('form', { name: 'Новый чат команды' });
    fireEvent.change(within(f).getByLabelText('Название чата'), { target: { value: 'Отдел' } });
    fireEvent.click(within(f).getByLabelText(/Анна Петрова/));
    fireEvent.click(within(f).getByRole('button', { name: 'Создать чат' }));
  };

  it('создан — POST, тост, список обновлён, чат открыт', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/staff-chat/conversations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, conversationId: 'new' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, rows: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    create();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Чат создан'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/staff-chat/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Отдел', participantIds: ['u2'] }),
      })
    );
    expect(refetch).toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/staff-chat/messages?conversationId=new')
    );
  });

  it('сервер отказал — тост с объяснением, форма открыта', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: 'forbidden' }) })
    );
    create();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole('form', { name: 'Новый чат команды' })).toBeTruthy();
  });

  it('ответ без тела — общий текст; обрыв связи — тост про сеть', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error('not json');
        },
      })
    );
    create();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось создать чат.'));
    toastError.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
