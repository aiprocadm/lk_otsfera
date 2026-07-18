// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatComposer } from '@/components/chat/chat-composer';

describe('ChatComposer (interactive)', () => {
  it('submit button is disabled when text is empty', () => {
    render(React.createElement(ChatComposer, { onSend: vi.fn() }));
    const button = screen.getByRole('button', { name: 'Отправить' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('typing enables the submit button, submitting calls onSend with trimmed text and clears the textarea on success', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(React.createElement(ChatComposer, { onSend }));
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  привет  ' } });
    const button = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith('привет');
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('keeps the typed text in the textarea when onSend reports failure', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(React.createElement(ChatComposer, { onSend }));
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'важное сообщение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(onSend).toHaveBeenCalledWith('важное сообщение');
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(textarea.value).toBe('важное сообщение');
  });

  it('submitting whitespace-only text does not call onSend (trimmed empty guard)', () => {
    const onSend = vi.fn();
    render(React.createElement(ChatComposer, { onSend }));
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    const form = textarea.closest('form') as HTMLFormElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('submitting while disabled does not call onSend, even with non-empty text forced via submit event', () => {
    const onSend = vi.fn();
    render(React.createElement(ChatComposer, { onSend, disabled: true }));
    const textarea = screen.getByLabelText('Сообщение') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    const form = textarea.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not render the attach affordance when onAttachFile is absent', () => {
    render(React.createElement(ChatComposer, { onSend: vi.fn() }));
    expect(screen.queryByTitle('Прикрепить файл')).toBeNull();
  });

  it('selecting a file calls onAttachFile and resets the input value so the same file can be re-picked', () => {
    const onAttachFile = vi.fn();
    render(React.createElement(ChatComposer, { onSend: vi.fn(), onAttachFile }));
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    expect(input.type).toBe('file');
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    expect(onAttachFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('file input change with no file selected does not call onAttachFile', () => {
    const onAttachFile = vi.fn();
    render(React.createElement(ChatComposer, { onSend: vi.fn(), onAttachFile }));
    const input = screen.getByTitle('Прикрепить файл').nextElementSibling as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [] });
    fireEvent.change(input);
    expect(onAttachFile).not.toHaveBeenCalled();
  });
});
