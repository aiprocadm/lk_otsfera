// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Ответ во «Входящих письмах» (`У-316`): у письма — «Копия» (адреса через
 * запятую, точку с запятой или пробел) и подпись, видная до отправки; у
 * мессенджера — только текст.
 */
const { replyInboundAction } = vi.hoisted(() => ({ replyInboundAction: vi.fn() }));
vi.mock('@/server-actions/inbound', () => ({ replyInboundAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { InboxReplyForm } from '@/components/manager/inbox-reply-form';

beforeEach(() => vi.clearAllMocks());

describe('InboxReplyForm', () => {
  it('письмо: копия разбирается на адреса, подпись видна', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(
      <InboxReplyForm inboundMessageId="im-1" email={{ signature: '-- \nС уважением,\nАнна' }} />
    );
    expect(screen.getByLabelText('Подпись').textContent).toBe('-- \nС уважением,\nАнна');
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'Добрый день' } });
    fireEvent.change(screen.getByLabelText('Копия'), {
      target: { value: 'boss@mail.ru, acc@mail.ru;  x@y.ru ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({
        inboundMessageId: 'im-1',
        text: 'Добрый день',
        cc: ['boss@mail.ru', 'acc@mail.ru', 'x@y.ru'],
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ответ отправлен'));
  });

  it('письмо без подписи — блока подписи нет; пустая копия — пустой список', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<InboxReplyForm inboundMessageId="im-2" email={{ signature: '' }} />);
    expect(screen.queryByLabelText('Подпись')).toBeNull();
    const cc = screen.getByLabelText('Копия') as HTMLInputElement;
    cc.removeAttribute('name');
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'т' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({
        inboundMessageId: 'im-2',
        text: 'т',
        cc: [],
      })
    );
  });

  it('поле текста без name → защитный ?? отдаёт пустой текст', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<InboxReplyForm inboundMessageId="im-5" />);
    const textarea = screen.getByLabelText('Текст ответа');
    fireEvent.change(textarea, { target: { value: 'x' } });
    textarea.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'im-5', text: '' })
    );
  });

  it('кривой адрес в копии — сервер отказал, форма объясняет', async () => {
    replyInboundAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<InboxReplyForm inboundMessageId="im-4" email={{ signature: '' }} />);
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'т' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Обращение не найдено.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('мессенджер — без копии и подписи, в действие копия не уходит', async () => {
    replyInboundAction.mockResolvedValue({ ok: true });
    render(<InboxReplyForm inboundMessageId="im-3" />);
    expect(screen.queryByLabelText('Копия')).toBeNull();
    fireEvent.change(screen.getByLabelText('Текст ответа'), { target: { value: 'т' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await waitFor(() =>
      expect(replyInboundAction).toHaveBeenCalledWith({ inboundMessageId: 'im-3', text: 'т' })
    );
  });
});
