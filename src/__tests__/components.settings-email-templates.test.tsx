// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * «Тексты писем» (`У-128`, решение `Р-23`): экран и редактор.
 *
 * Главное обещание экрана: **пустые поля означают «как раньше»**. Стандартный
 * текст сюда не копируется — копия заморозила бы письмо. Второе обещание —
 * список подстановок стоит рядом с полями, а не в справке: иначе человек
 * угадывает имена и получает отказ сохранить.
 */
const actions = vi.hoisted(() => ({
  previewTemplateAction: vi.fn(),
  resetTemplateAction: vi.fn(),
  saveTemplateAction: vi.fn(),
  sendTestTemplateAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/emailTemplates', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { EmailTemplatesScreen } from '@/components/settings/email-templates-screen';
import { EmailTemplatesEditor } from '@/components/settings/email-templates-editor';
import type { TemplateRow } from '@/lib/email/templateOverrides';

const row = (over: Partial<TemplateRow> = {}): TemplateRow =>
  ({
    key: 'notification',
    label: 'Общее уведомление',
    subject: '',
    body: '',
    source: 'default',
    ...over,
  }) as TemplateRow;

/** Раскрыть карточку письма. */
function open(label = 'Общее уведомление') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.saveTemplateAction.mockResolvedValue({ ok: true });
  actions.resetTemplateAction.mockResolvedValue({ ok: true });
  actions.previewTemplateAction.mockResolvedValue({ ok: true, subject: 'Тема', body: 'Текст' });
  actions.sendTestTemplateAction.mockResolvedValue({ ok: true, skipped: false });
});

describe('EmailTemplatesScreen — оболочка экрана', () => {
  it('у администратора подзаголовок говорит про платформу', () => {
    render(<EmailTemplatesScreen cabinet="admin" hasCompany={false} rows={[row()]} />);

    expect(screen.getByText(/действуют на всей платформе/)).toBeTruthy();
  });

  it('у руководителя — про его компанию', () => {
    render(<EmailTemplatesScreen cabinet="leader" hasCompany rows={[row()]} />);

    expect(screen.getByText(/для писем вашей компании/)).toBeTruthy();
  });

  it('руководитель без компании видит объяснение вместо редактора', () => {
    render(<EmailTemplatesScreen cabinet="leader" hasCompany={false} rows={[row()]} />);

    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
    expect(screen.queryByText(/Пока поля пустые/)).toBeNull();
  });
});

describe('EmailTemplatesEditor — карточка письма', () => {
  it('свёрнутая карточка обещает «как раньше», пока поля пусты', () => {
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);

    expect(screen.getByText(/Пока поля пустые, письмо собирает программа/)).toBeTruthy();
    expect(screen.queryByText('Тема письма')).toBeNull();
  });

  it('раскрытие показывает поля и список подстановок рядом', () => {
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    expect(screen.getByText('Тема письма')).toBeTruthy();
    expect(screen.getByText('Что можно подставить:')).toBeTruthy();
    expect(screen.getByText('{{title}}')).toBeTruthy();
  });

  it('повторное нажатие сворачивает карточку', () => {
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();
    open();

    expect(screen.queryByText('Тема письма')).toBeNull();
  });

  it('свой текст помечен — видно, что стандартный перекрыт', () => {
    const { unmount } = render(
      <EmailTemplatesEditor cabinet="leader" rows={[row({ source: 'company' })]} />
    );
    expect(screen.getByText('свой текст')).toBeTruthy();
    unmount();

    render(<EmailTemplatesEditor cabinet="admin" rows={[row({ source: 'platform' })]} />);
    expect(screen.getByText('текст платформы')).toBeTruthy();
  });

  it('«вернуть стандартный» показывается только там, где есть что возвращать', () => {
    const { unmount } = render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();
    expect(screen.queryByRole('button', { name: 'вернуть стандартный' })).toBeNull();
    unmount();

    render(<EmailTemplatesEditor cabinet="admin" rows={[row({ source: 'platform' })]} />);
    open();
    expect(screen.getByRole('button', { name: 'вернуть стандартный' })).toBeTruthy();
  });

  it('сохранение уходит с тем, что набрано', async () => {
    render(<EmailTemplatesEditor cabinet="leader" rows={[row()]} />);
    open();

    fireEvent.change(screen.getByPlaceholderText('Пусто — стандартная тема'), {
      target: { value: 'Новая тема' },
    });
    fireEvent.change(screen.getByPlaceholderText('Пусто — стандартный текст'), {
      target: { value: 'Новый текст' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(actions.saveTemplateAction).toHaveBeenCalledWith(
        'leader',
        'notification',
        'Новая тема',
        'Новый текст'
      )
    );
    expect(toastMock.success).toHaveBeenCalledWith('Текст письма сохранён.');
  });

  it('чужая подстановка называется поимённо, а не «ошибка»', async () => {
    actions.saveTemplateAction.mockResolvedValue({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['цена', 'скидка'],
    });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Неизвестные подстановки: {{цена}}, {{скидка}}. Возьмите из списка справа.'
      )
    );
  });

  it('список неизвестных подстановок может не прийти — сообщение всё равно осмысленно', async () => {
    actions.saveTemplateAction.mockResolvedValue({ ok: false, error: 'unknown_placeholder' });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Неизвестные подстановки: . Возьмите из списка справа.'
      )
    );
  });

  it.each([
    ['subject', 'Тема письма: слишком длинно. Максимум 300 символов.'],
    ['body', 'Текст письма: слишком длинно. Максимум 300 символов.'],
  ])('слишком длинное поле «%s» называет предел с сервера', async (field, text) => {
    actions.saveTemplateAction.mockResolvedValue({
      ok: false,
      error: 'text_too_long',
      limit: { field, max: 300 },
    });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(text));
  });

  it('предел без подробностей не роняет экран', async () => {
    actions.saveTemplateAction.mockResolvedValue({ ok: false, error: 'text_too_long' });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Текст письма: слишком длинно. Максимум 0 символов.'
      )
    );
  });

  it.each([
    [
      'company_required',
      'У вашей учётной записи не указана компания — обратитесь к администратору.',
    ],
    [
      'validation',
      'Заполните и тему, и текст — либо очистите оба поля, чтобы вернуть стандартное письмо.',
    ],
  ])('отказ «%s» объясняется словами', async (error, text) => {
    actions.saveTemplateAction.mockResolvedValue({ ok: false, error });
    render(<EmailTemplatesEditor cabinet="leader" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(text));
  });

  it('предпросмотр показывает, что увидит получатель', async () => {
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Показать, как получится' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Так письмо увидит получатель');
    expect(status.textContent).toContain('Тема');
  });

  it('предпросмотр с чужой подстановкой называет её и не показывает старое', async () => {
    actions.previewTemplateAction.mockResolvedValue({
      ok: false,
      error: 'unknown_placeholder',
      unknown: ['цена'],
    });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Показать, как получится' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Неизвестные подстановки: {{цена}}. Возьмите из списка справа.'
      )
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('прочий сбой предпросмотра — общее сообщение', async () => {
    actions.previewTemplateAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Показать, как получится' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Не удалось показать.'));
  });

  it('«вернуть стандартный» спрашивает подтверждение и чистит поля', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    render(
      <EmailTemplatesEditor
        cabinet="leader"
        rows={[row({ source: 'company', subject: 'Своя', body: 'Свой' })]}
      />
    );
    open();

    expect(
      (screen.getByPlaceholderText('Пусто — стандартная тема') as HTMLInputElement).value
    ).toBe('Своя');
    fireEvent.click(screen.getByRole('button', { name: 'вернуть стандартный' }));

    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Пусто — стандартная тема') as HTMLInputElement).value
      ).toBe('')
    );
    expect(toastMock.success).toHaveBeenCalledWith('Возвращён стандартный текст.');
  });

  it('отказ от подтверждения ничего не трогает', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );
    render(<EmailTemplatesEditor cabinet="leader" rows={[row({ source: 'company' })]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'вернуть стандартный' }));

    expect(actions.resetTemplateAction).not.toHaveBeenCalled();
  });

  it('отказ сброса объясняется причиной', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    actions.resetTemplateAction.mockResolvedValue({ ok: false, error: 'company_required' });
    render(<EmailTemplatesEditor cabinet="leader" rows={[row({ source: 'company' })]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'вернуть стандартный' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'У вашей учётной записи не указана компания — обратитесь к администратору.'
      )
    );
  });

  it('пробное письмо ушло — так и сказано', async () => {
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить себе' }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Пробное письмо отправлено вам на почту.')
    );
  });

  it('почта выключена — говорим честно, а не «отправлено»', async () => {
    actions.sendTestTemplateAction.mockResolvedValue({ ok: true, skipped: true });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить себе' }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Письмо не отправлено: отправка почты выключена или не задан адрес.'
      )
    );
  });

  it('сбой отправки показывается ошибкой', async () => {
    actions.sendTestTemplateAction.mockResolvedValue({ ok: false, error: 'send_failed' });
    render(<EmailTemplatesEditor cabinet="admin" rows={[row()]} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить себе' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Не удалось отправить пробное письмо.')
    );
  });

  it('открыта всегда одна карточка — вторая закрывает первую', () => {
    render(
      <EmailTemplatesEditor
        cabinet="admin"
        rows={[row(), row({ key: 'orgDocumentPublished', label: 'Заказчику: документ' })]}
      />
    );

    open();
    expect(screen.getAllByText('Тема письма')).toHaveLength(1);

    open('Заказчику: документ');
    expect(screen.getAllByText('Тема письма')).toHaveLength(1);
  });
});
