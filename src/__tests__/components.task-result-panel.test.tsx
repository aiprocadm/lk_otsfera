// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Панель «Результат» задачи (этап 5 ТЗ 13.10.2026, `У-299`, `Р-5-3`): текст
 * сохраняется действием, файл — роутом; видно, что файл ещё проверяется, и
 * удалить можно только «свой» файл.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));
const { setTaskResultAction } = vi.hoisted(() => ({ setTaskResultAction: vi.fn() }));
vi.mock('@/server-actions/tasks', () => ({ setTaskResultAction }));

import { TaskResultPanel } from '@/components/tasks/task-result-panel';

const FILES = [
  {
    id: 'f1',
    name: 'акт.pdf',
    size: 2 * 1024 * 1024,
    scanStatus: 'clean',
    createdAt: new Date(),
    createdByName: 'Иван',
    canDelete: true,
  },
  {
    id: 'f2',
    name: 'фото.jpg',
    size: 300,
    scanStatus: 'pending',
    createdAt: new Date(),
    createdByName: 'Мария',
    canDelete: false,
  },
];

const reply = (ok: boolean, body: unknown) =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  }));

beforeEach(() => vi.clearAllMocks());

describe('TaskResultPanel', () => {
  it('текст сохраняется действием; кнопка неактивна без правок', async () => {
    setTaskResultAction.mockResolvedValue({ ok: true });
    render(<TaskResultPanel taskId="t1" result={null} resultUpdatedAt={null} files={[]} />);
    const save = screen.getByRole('button', { name: 'Сохранить результат' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Опишите, что сделано/)).toBeTruthy();
    expect(screen.getByText(/Файлы не приложены/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Что получилось'), { target: { value: 'Готово' } });
    fireEvent.click(save);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    const fd = setTaskResultAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('t1');
    expect(fd.get('result')).toBe('Готово');
    expect(toastMock.success).toHaveBeenCalledWith('Результат сохранён.');
  });

  it('отказ сохранения — понятная строка, страница не обновляется', async () => {
    setTaskResultAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<TaskResultPanel taskId="t1" result="было" resultUpdatedAt={new Date()} files={[]} />);
    expect(screen.getByText(/Обновлено/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Что получилось'), { target: { value: 'стало' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить результат' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('файлы: ссылки на скачивание, размер, «проверяется», удаление только своего', () => {
    const { container } = render(
      <TaskResultPanel taskId="t1" result={null} resultUpdatedAt={null} files={FILES} />
    );
    expect(container.querySelector('a[href="/api/tasks/result-files/f1"]')?.textContent).toBe(
      'акт.pdf'
    );
    expect(screen.getByText('2.0 МБ')).toBeTruthy();
    expect(screen.getByText('1 КБ')).toBeTruthy();
    expect(screen.getByText('проверяется антивирусом')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(1);
    // Подсказка предела — из общей настройки, а не цифрой в разметке.
    expect(screen.getByText(/не больше 200 МБ/)).toBeTruthy();
  });

  it('приложить файл — роут; успех обновляет страницу, отказ объясняет', async () => {
    const ok = reply(true, { id: 'f3' });
    vi.stubGlobal('fetch', ok);
    const { container } = render(
      <TaskResultPanel taskId="t1" result={null} resultUpdatedAt={null} files={[]} />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf')] } });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(ok.mock.calls[0][0]).toBe('/api/tasks/t1/result-files');

    vi.stubGlobal('fetch', reply(false, { error: 'too_large' }));
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.pdf')] } });
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Файл превышает допустимый размер.')
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    fireEvent.change(input, { target: { files: [new File(['x'], 'c.pdf')] } });
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenLastCalledWith('Нет связи с сервером — попробуйте ещё раз.')
    );
    // Пустой выбор (отмена в окне файла) — ничего не отправляется.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.change(input, { target: { files: [] } });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it('удаление — DELETE роута; отказ и обрыв связи — объяснение', async () => {
    const ok = reply(true, { ok: true });
    vi.stubGlobal('fetch', ok);
    render(<TaskResultPanel taskId="t1" result={null} resultUpdatedAt={null} files={FILES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(ok).toHaveBeenCalledWith('/api/tasks/result-files/f1', { method: 'DELETE' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => {
          throw new Error('not json');
        },
      }))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenLastCalledWith('Нет связи с сервером — попробуйте ещё раз.')
    );
  });
});
