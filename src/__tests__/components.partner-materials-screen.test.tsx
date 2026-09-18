// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { HubMaterialRow } from '@/lib/services/partnerMaterials/hub';

const { push, refresh, toastError, toastSuccess, publish, unpublish, update } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  update: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/server-actions/admin/partnerMaterials', () => ({
  publishPartnerMaterialAction: publish,
  unpublishPartnerMaterialAction: unpublish,
  updatePartnerMaterialAction: update,
}));
vi.mock('@/components/partner-materials/partner-material-upload-form', () => ({
  PartnerMaterialUploadForm: ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'upload-form' },
      React.createElement('button', { onClick: onDone }, 'done'),
      React.createElement('button', { onClick: onCancel }, 'cancel')
    ),
}));

import {
  PartnerMaterialsScreen,
  materialStatus,
} from '@/components/partner-materials/partner-materials-screen';

/** Экран хаба «Материалы для партнёров» (`У-237`). */
function row(over: Partial<HubMaterialRow> = {}): HubMaterialRow {
  return {
    id: 'm1',
    companyId: 'c1',
    companyName: 'УЦ',
    title: 'Прайс',
    description: 'осень',
    category: 'price_list',
    externalUrl: null,
    isActive: true,
    publishedAt: null,
    sortOrder: 0,
    updatedAt: new Date('2026-09-17T10:00:00Z'),
    updatedByName: 'Анна',
    file: {
      id: 'f1',
      fileName: 'p.pdf',
      mimeType: 'application/pdf',
      size: 10,
      scanStatus: 'clean',
      scanReason: null,
    },
    downloadsCount: 2,
    downloads: [{ userName: 'Партнёр П', at: new Date('2026-09-17T11:00:00Z') }],
    ...over,
  };
}

const COMPANIES = [
  { id: 'c1', name: 'УЦ' },
  { id: 'c2', name: 'Второй УЦ' },
];

function mount(
  rows: HubMaterialRow[],
  over: Partial<React.ComponentProps<typeof PartnerMaterialsScreen>> = {}
) {
  return render(
    React.createElement(PartnerMaterialsScreen, {
      cabinet: 'admin',
      companyId: 'c1',
      companies: COMPANIES,
      rows,
      ...over,
    })
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  publish.mockResolvedValue({ ok: true });
  unpublish.mockResolvedValue({ ok: true });
  update.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('materialStatus', () => {
  it('заражён > проверяется > снят > опубликован > черновик', () => {
    expect(materialStatus(row({ file: { ...row().file!, scanStatus: 'infected' } })).label).toBe(
      'Файл заражён'
    );
    expect(materialStatus(row({ file: { ...row().file!, scanStatus: 'pending' } })).label).toBe(
      'Проверяется'
    );
    expect(materialStatus(row({ isActive: false, publishedAt: new Date() })).label).toBe(
      'Снят с публикации'
    );
    expect(materialStatus(row({ publishedAt: new Date() })).label).toBe('Опубликован');
    expect(materialStatus(row()).label).toBe('Черновик');
    expect(materialStatus(row({ file: null, externalUrl: 'https://x' })).label).toBe('Черновик');
  });
});

describe('PartnerMaterialsScreen', () => {
  it('заголовок, подзаголовок, выбор компании (админ), «Добавить материал» открывает форму, done закрывает и перечитывает', () => {
    mount([row()]);
    expect(screen.getByRole('heading', { name: 'Материалы для партнёров' })).toBeTruthy();
    expect(screen.getByText(/партнёры видят в своём кабинете/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('company-select'), { target: { value: 'c2' } });
    expect(push).toHaveBeenCalledWith('/admin/settings/processes/partner-materials?company=c2');
    fireEvent.click(screen.getByTestId('add-material'));
    expect(screen.getByTestId('upload-form')).toBeTruthy();
    fireEvent.click(screen.getByText('done'));
    expect(screen.queryByTestId('upload-form')).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('руководитель без компании — объяснение, без кнопки; пустой список — объяснение с кнопкой', () => {
    mount([], { cabinet: 'leader', companyId: null, companies: [] });
    expect(screen.getByText(/нет компании/)).toBeTruthy();
    expect(screen.queryByTestId('add-material')).toBeNull();
  });

  it('пустой список у компании: подсказка и кнопка открывают форму', () => {
    mount([], { cabinet: 'leader', companies: [] });
    expect(screen.getByText(/Материалов пока нет — добавьте первый/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить материал' })[1]!);
    expect(screen.getByTestId('upload-form')).toBeTruthy();
  });

  it('карточка: категория, статус, файл, автор; «кто скачал» раскрывается; опубликовать → действие с id и тост', async () => {
    mount([row()]);
    expect(screen.getByText('Прайс-листы')).toBeTruthy();
    expect(screen.getByText('Черновик')).toBeTruthy();
    expect(screen.getByText(/Файл: p\.pdf/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('downloads-toggle-m1'));
    expect(screen.getByTestId('downloads-list').textContent).toContain('Партнёр П');
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toBe('admin');
    expect((publish.mock.calls[0][1] as FormData).get('id')).toBe('m1');
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('опубликован'));
    expect(refresh).toHaveBeenCalled();
  });

  it('«кто скачал» закрывается тем же нажатием, что и открылся', () => {
    mount([row()]);
    fireEvent.click(screen.getByTestId('downloads-toggle-m1'));
    expect(screen.queryByTestId('downloads-list')).toBeTruthy();
    fireEvent.click(screen.getByTestId('downloads-toggle-m1'));
    expect(screen.queryByTestId('downloads-list')).toBeNull();
  });

  it('у администратора компания ещё не выбрана — экран цел, выбор на месте', () => {
    // Пустое значение выбора: браузер подставит первую компанию, а экран не
    // должен ни падать, ни прятать переключатель.
    mount([], { companyId: null });
    expect(screen.getByTestId('company-select')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Материалы для партнёров' })).toBeTruthy();
  });

  it('материал без описания: поле правки пустое, а не со словом null', () => {
    mount([row({ description: null })]);
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    const area = screen.getByTestId('edit-form-m1').querySelector('textarea');
    expect(area?.value).toBe('');
  });

  it('замена файла сорвалась без внятного ответа — человек всё равно видит причину', async () => {
    // Роут может ответить пустым телом: тогда подставляется код по статусу,
    // и тост не должен оказаться пустым.
    mount([row()]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    const input = screen.getByTestId('replace-file-m1') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'new.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0]).length).toBeGreaterThan(5);
  });

  it('передумал добавлять: «Отмена» закрывает форму и ничего не перечитывает', () => {
    mount([row()]);
    fireEvent.click(screen.getByTestId('add-material'));
    expect(screen.getByTestId('upload-form')).toBeTruthy();
    fireEvent.click(screen.getByText('cancel'));
    expect(screen.queryByTestId('upload-form')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('передумал править: «Отмена» закрывает форму правки без сохранения', () => {
    mount([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    expect(screen.getByTestId('edit-form-m1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByTestId('edit-form-m1')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('«Заменить файл» открывает выбор файла, а не делает вид', () => {
    // Настоящий `input type=file` спрятан: кнопка обязана нажать именно его,
    // иначе замена файла не начнётся вовсе.
    mount([row()]);
    const input = screen.getByTestId('replace-file-m1') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Заменить файл' }));
    expect(click).toHaveBeenCalled();
  });

  it('сервис отказал без кода вовсе — общая русская подсказка', async () => {
    // Крайний случай: `{ ok: false }` без `error` и без текстов. Тост обязан
    // быть осмысленным, иначе человек увидит пустую плашку.
    publish.mockResolvedValueOnce({ ok: false });
    mount([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0]).length).toBeGreaterThan(5);
  });

  it('замена файла отклонена с текстами — показываем их, а не общий код', async () => {
    mount([row()]);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'validation', messages: ['Файл больше 200 МБ.'] }),
    });
    fireEvent.change(screen.getByTestId('replace-file-m1'), {
      target: { files: [new File(['%PDF'], 'big.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Файл больше 200 МБ.'));
  });

  it('материал ещё никто не скачивал — так и написано, а не пустая рамка', () => {
    mount([row({ downloadsCount: 0, downloads: [] })]);
    fireEvent.click(screen.getByTestId('downloads-toggle-m1'));
    expect(screen.getByTestId('downloads-list').textContent).toContain('Пока никто не скачивал');
  });

  it('незнакомый код отказа — общая русская подсказка, а не пустой тост', async () => {
    // Сервис может завести новый код раньше экрана: человек обязан увидеть
    // осмысленную строку, а не пустоту.
    publish.mockResolvedValueOnce({ ok: false, error: 'какой_то_новый_код' });
    mount([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0]).length).toBeGreaterThan(5);
  });

  it('файл ещё проверяется — кнопки публикации нет; заражён — подсказка про замену; not_ready от сервиса — русская ошибка', async () => {
    const { unmount } = mount([row({ file: { ...row().file!, scanStatus: 'pending' } })]);
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();
    expect(screen.getByText('Проверяется')).toBeTruthy();
    unmount();
    mount([row({ file: { ...row().file!, scanStatus: 'infected', scanReason: 'Eicar' } })]);
    expect(screen.getByText(/Eicar/)).toBeTruthy();
  });

  it('опубликованный: «Снять с публикации» → действие; снятый: «Вернуть в публикацию»', async () => {
    const { unmount } = mount([row({ publishedAt: new Date('2026-09-01') })]);
    fireEvent.click(screen.getByRole('button', { name: 'Снять с публикации' }));
    await waitFor(() => expect(unpublish).toHaveBeenCalled());
    unmount();
    mount([row({ publishedAt: new Date('2026-09-01'), isActive: false })]);
    expect(screen.getByRole('button', { name: 'Вернуть в публикацию' })).toBeTruthy();
  });

  it('ошибка действия — русская подсказка по коду или тексты сервиса', async () => {
    publish.mockResolvedValueOnce({ ok: false, error: 'not_ready' });
    const { unmount } = mount([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('проверяется'))
    );
    unmount();
    update.mockResolvedValueOnce({
      ok: false,
      error: 'validation',
      messages: ['Название обязательно.'],
    });
    mount([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.submit(screen.getByTestId('edit-form-m1'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Название обязательно.'));
  });

  it('редактирование: форма с полями, сохранение шлёт id и поля, закрывает форму', async () => {
    mount([row({ externalUrl: 'https://x', file: null })]);
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новый' } });
    expect(screen.getByLabelText('Ссылка')).toBeTruthy();
    fireEvent.submit(screen.getByTestId('edit-form-m1'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const fd = update.mock.calls[0][1] as FormData;
    expect(fd.get('id')).toBe('m1');
    expect(fd.get('title')).toBe('Новый');
    await waitFor(() => expect(screen.queryByTestId('edit-form-m1')).toBeNull());
  });

  it('замена файла: fetch на роут файла; ошибка — тост; у материала-ссылки кнопки нет', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const { unmount } = mount([row()]);
    const input = screen.getByTestId('replace-file-m1') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'n.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/partner-materials/m1/file',
        expect.objectContaining({ method: 'POST' })
      )
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('заменён'))
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 415,
      json: async () => ({ error: 'invalid_mime' }),
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    unmount();
    mount([row({ externalUrl: 'https://x', file: null })]);
    expect(screen.queryByRole('button', { name: 'Заменить файл' })).toBeNull();
  });
});
