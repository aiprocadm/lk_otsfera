// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  archiveContactAction: vi.fn(),
  restoreContactAction: vi.fn(),
}));
vi.mock('@/server-actions/contacts', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { ArchiveContactButton } from '@/components/manager/contacts/archive-contact-button';

/**
 * «В архив» / «Вернуть из архива» (этап 1 ТЗ 12.09.2026, `У-180`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.4): контакты не удаляются;
 * успех — тост и перечитывание страницы, отказ — тост с текстом словаря формы.
 */
beforeEach(() => vi.clearAllMocks());

describe('ArchiveContactButton', () => {
  it('активный контакт: «В архив» → archiveContactAction, тост, refresh', async () => {
    actions.archiveContactAction.mockResolvedValue({ ok: true, contactId: 'c1' });
    render(<ArchiveContactButton contactId="c1" isArchived={false} />);
    expect(screen.queryByRole('button', { name: 'Вернуть из архива' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(actions.archiveContactAction).toHaveBeenCalledWith({ id: 'c1' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Контакт в архиве'));
    expect(nav.refresh).toHaveBeenCalled();
    expect(actions.restoreContactAction).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('архивный контакт: «Вернуть из архива» → restoreContactAction, тост, refresh', async () => {
    actions.restoreContactAction.mockResolvedValue({ ok: true, contactId: 'c1' });
    render(<ArchiveContactButton contactId="c1" isArchived />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть из архива' }));
    await waitFor(() => expect(actions.restoreContactAction).toHaveBeenCalledWith({ id: 'c1' }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Контакт возвращён из архива')
    );
    expect(nav.refresh).toHaveBeenCalled();
    expect(actions.archiveContactAction).not.toHaveBeenCalled();
  });

  it('отказ → toast.error с текстом словаря формы, страница не перечитывается', async () => {
    actions.restoreContactAction.mockResolvedValue({ ok: false, error: 'invalid' });
    render(<ArchiveContactButton contactId="c1" isArchived />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть из архива' }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Этот контакт объединён с другим — вернуть его нельзя, откройте главный.'
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
