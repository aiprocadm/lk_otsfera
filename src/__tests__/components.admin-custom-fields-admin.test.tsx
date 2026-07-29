// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CustomFieldDefinition } from '@prisma/client';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CustomFieldsAdmin as CustomFieldsAdminReal } from '@/components/admin/custom-fields-admin';

// Этап 1 PR-2: у экрана появились обязательные пропсы (сущность, системные поля,
// базовый путь). Шим подставляет их по умолчанию, чтобы существующие проверки
// поведения диалогов остались как есть.
function CustomFieldsAdmin(props: {
  definitions: CustomFieldDefinition[];
  entity?: 'order' | 'organization' | 'partner' | 'student' | 'document';
  systemFields?: { key: string; label: string; source: string }[];
  basePath?: string;
}) {
  return React.createElement(CustomFieldsAdminReal, {
    entity: props.entity ?? 'order',
    systemFields: props.systemFields ?? [],
    basePath: props.basePath ?? '/admin/custom-fields',
    definitions: props.definitions
  });
}

function field(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: 'f1',
    entityType: 'order',
    key: 'urgent',
    label: 'Срочно',
    fieldType: 'boolean',
    options: [],
    required: false,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    helpText: null,
    visibleToRoles: [],
    editableByRoles: [],
    isSystem: false,
    ...overrides
  } as CustomFieldDefinition;
}

describe('CustomFieldsAdmin', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Both the add and edit <dialog>s are always mounted (only `open` toggles),
  // and both contain "Название"/"Ключ"/"Порядок отображения" labels with the
  // same text — scope queries to the currently-open <dialog> to disambiguate.
  function openDialog(): HTMLElement {
    return document.querySelector('dialog[open]') as HTMLElement;
  }

  it('renders the "no fields" row when the list is empty', () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    expect(screen.getByText('Нет настраиваемых полей')).toBeTruthy();
  });

  it('renders a row per field with label/key/type/required/active', () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [
          field({ id: 'f1', label: 'Срочно', key: 'urgent', fieldType: 'boolean', required: true }),
          field({ id: 'f2', label: 'Кол-во', key: 'qty', fieldType: 'number', required: false, isActive: false })
        ]
      })
    );
    expect(screen.getByText('Срочно')).toBeTruthy();
    expect(screen.getByText('urgent')).toBeTruthy();
    // "Да / Нет" also appears as an <option> inside the always-mounted add-dialog's
    // select — scope to the table cell (<td>) to disambiguate.
    expect(screen.getByText('Да / Нет', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Кол-во')).toBeTruthy();
    expect(screen.getByText('Число', { selector: 'td' })).toBeTruthy();
  });

  it('falls back to the raw fieldType string when it is not in FIELD_TYPE_OPTIONS', async () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [field({ fieldType: 'weird' as CustomFieldDefinition['fieldType'] })]
      })
    );
    expect(screen.getByText('weird')).toBeTruthy();

    // тот же фолбэк в диалоге правки (тип показан только для чтения)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = document.querySelector('dialog[open]') as HTMLElement;
    expect((within(dialogEl).getByLabelText('Тип поля') as HTMLInputElement).value).toBe('weird');
  });

  it('only active fields show the "Деактивировать" button', () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [field({ id: 'f1', isActive: true }), field({ id: 'f2', isActive: false })]
      })
    );
    expect(screen.getAllByRole('button', { name: 'Деактивировать' }).length).toBe(1);
  });

  it('opening the add dialog and submitting a text field posts JSON without options, shows toast, closes, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    expect(await screen.findByText('Новое настраиваемое поле')).toBeTruthy();

    const dialogEl = openDialog();
    // Trailing/leading spaces would fail the key input's `pattern` (native constraint
    // validation blocks submit), so lead/trail whitespace lives only in the label field
    // — component-side `.trim()` on both is exercised via the label value instead.
    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: '  Комментарий  ' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), { target: { value: 'comment' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields',
        expect.objectContaining({
          method: 'POST',
          // JSON.stringify drops keys whose value is `undefined` entirely (options omitted).
          body: JSON.stringify({
            entityType: 'order',
            key: 'comment',
            label: 'Комментарий',
            fieldType: 'text',
            required: false,
            sortOrder: 0,
            helpText: null,
            visibleToRoles: [],
            editableByRoles: []
          })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Поле добавлено.'));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('selecting fieldType=select reveals the options field; submit parses/trims/filters comma-separated options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();

    fireEvent.change(within(dialogEl).getByLabelText('Тип поля'), { target: { value: 'select' } });
    expect(within(dialogEl).getByLabelText('Варианты (через запятую)')).toBeTruthy();

    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'Статус' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), { target: { value: 'status' } });
    fireEvent.change(within(dialogEl).getByLabelText('Варианты (через запятую)'), {
      target: { value: ' a, b ,, c ' }
    });
    fireEvent.click(within(dialogEl).getByRole('checkbox', { name: 'Обязательное поле' }));
    fireEvent.change(within(dialogEl).getByLabelText('Порядок отображения'), { target: { value: '3' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields',
        expect.objectContaining({
          body: JSON.stringify({
            entityType: 'order',
            key: 'status',
            label: 'Статус',
            fieldType: 'select',
            options: ['a', 'b', 'c'],
            required: true,
            sortOrder: 3,
            helpText: null,
            visibleToRoles: [],
            editableByRoles: []
          })
        })
      )
    );
  });

  it('add with an empty sortOrder field defaults to 0 (Number(fd.get(...) || 0) branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();
    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), { target: { value: 'x' } });
    fireEvent.change(within(dialogEl).getByLabelText('Порядок отображения'), { target: { value: '' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields',
        expect.objectContaining({ body: expect.stringContaining('"sortOrder":0') })
      )
    );
  });

  it('add failure (with error body) shows the mapped toast error, dialog stays open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'duplicate_key' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();
    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), { target: { value: 'x' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('Новое настраиваемое поле')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('add failure with unparsable json still shows a toast error (catch->{} fallback)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();
    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), { target: { value: 'x' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('cancel closes the add dialog without submitting', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('Escape closes the add dialog via the Dialog primitive\'s onClose prop', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('EditFieldDialog returns null (no dialog rendered) when editTarget is null (no "Изменить направление"-style heading exists initially)', () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    expect(screen.queryByText('Изменить поле')).toBeNull();
  });

  it('opening the edit dialog pre-fills label/key(readonly)/required/sortOrder for a non-select field', async () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [field({ label: 'Старая метка', key: 'oldkey', sortOrder: 9, required: true })]
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить поле')).toBeTruthy();
    const dialogEl = openDialog();

    expect((within(dialogEl).getByLabelText('Название') as HTMLInputElement).value).toBe('Старая метка');
    expect((within(dialogEl).getByLabelText('Ключ') as HTMLInputElement).value).toBe('oldkey');
    expect((within(dialogEl).getByLabelText('Ключ') as HTMLInputElement).readOnly).toBe(true);
    expect((within(dialogEl).getByRole('checkbox', { name: 'Обязательное поле' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialogEl).getByLabelText('Порядок отображения') as HTMLInputElement).value).toBe('9');
    expect(within(dialogEl).queryByLabelText('Варианты (через запятую)')).toBeNull();
  });

  it('opening the edit dialog for a select-type field shows prefilled joined options', async () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [field({ fieldType: 'select', options: ['a', 'b', 'c'] })]
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = openDialog();
    expect((within(dialogEl).getByLabelText('Варианты (через запятую)') as HTMLTextAreaElement).value).toBe('a, b, c');
  });

  it('edit success: PATCHes the field id with new label/options/required/sortOrder, shows toast, closes, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [field({ id: 'f9', fieldType: 'select', options: ['x'] })]
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = openDialog();

    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'Новая метка' } });
    fireEvent.change(within(dialogEl).getByLabelText('Варианты (через запятую)'), { target: { value: 'x, y' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields/f9',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            label: 'Новая метка',
            options: ['x', 'y'],
            required: false,
            sortOrder: 1,
            helpText: null,
            visibleToRoles: [],
            editableByRoles: []
          })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Поле обновлено.'));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('edit for a non-select field sends options: undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field({ id: 'f9', fieldType: 'text' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields/f9',
        expect.objectContaining({
          // JSON.stringify drops keys whose value is `undefined` entirely.
          body: JSON.stringify({
            label: 'Срочно',
            options: undefined,
            required: false,
            sortOrder: 1,
            helpText: null,
            visibleToRoles: [],
            editableByRoles: []
          })
        })
      )
    );
  });

  it('edit with an empty sortOrder field defaults to 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field({ id: 'f9' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = openDialog();
    fireEvent.change(within(dialogEl).getByLabelText('Порядок отображения'), { target: { value: '' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields/f9',
        expect.objectContaining({ body: expect.stringContaining('"sortOrder":0') })
      )
    );
  });

  it('edit failure shows the mapped toast error and keeps the dialog open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('Изменить поле')).toBeTruthy();
  });

  it('edit failure with unparsable json still shows a toast error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('cancel closes the edit dialog', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('Escape closes the edit dialog via the Dialog primitive\'s onClose prop', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('deactivate success: DELETEs the field id, shows toast, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field({ id: 'f5', isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/custom-fields/f5', { method: 'DELETE' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Поле деактивировано.'));
    expect(refresh).toHaveBeenCalled();
  });

  it('deactivate failure (with error body) shows the mapped toast error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'forbidden' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field({ isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('deactivate failure with unparsable json still shows a toast error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [field({ isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

// ─── Этап 1 PR-2 (§11 ТЗ v0.5): сущности, роли, подсказка, системные поля ────

describe('CustomFieldsAdmin — экран настройки §11', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function openDialog(): HTMLElement {
    return document.querySelector('dialog[open]') as HTMLElement;
  }

  it('вкладки ведут на все пять сущностей и знают текущую', () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [],
        entity: 'partner',
        basePath: '/leader/settings/custom-fields'
      })
    );

    const tab = screen.getByRole('link', { name: 'Партнёр' });
    expect(tab.getAttribute('href')).toBe('/leader/settings/custom-fields?entity=partner');
    // ссылки строятся от переданного basePath — у руководителя это его кабинет
    expect(screen.getByRole('link', { name: 'Заявка' }).getAttribute('href')).toBe(
      '/leader/settings/custom-fields?entity=order'
    );
    for (const label of ['Заявка', 'Организация', 'Партнёр', 'Сотрудник организации', 'Документ']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('блок системных полей показывается и не даёт кнопок', () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [],
        entity: 'organization',
        systemFields: [
          { key: 'name', label: 'Название', source: 'Карточка организации' },
          { key: 'status', label: 'Статус', source: 'Карточка организации' }
        ]
      })
    );

    expect(screen.getByText('Системные поля')).toBeTruthy();
    expect(screen.getAllByText('системное').length).toBe(2);
    // «Название» есть и в заголовке таблицы — ищем внутри блока системных полей
    const systemBlock = screen.getByText('Системные поля').parentElement as HTMLElement;
    expect(within(systemBlock).getByText('Название')).toBeTruthy();
    expect(within(systemBlock).getByText('status')).toBeTruthy();
    // у системных полей нет ни «Изменить», ни «Деактивировать»
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Деактивировать' })).toBeNull();
  });

  it('без системных полей блок не рендерится вовсе', () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [], entity: 'order' }));
    expect(screen.queryByText('Системные поля')).toBeNull();
  });

  it('пустые списки ролей в таблице читаются как «по умолчанию», а не «никому»', () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [field()] }));
    expect(screen.getByText('Все, кто видит карточку')).toBeTruthy();
    expect(screen.getByText('Администратор, руководитель')).toBeTruthy();
  });

  it('заданные роли и подсказка выводятся русскими подписями', () => {
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [
          field({
            helpText: 'Заполняет бухгалтерия',
            visibleToRoles: ['admin', 'leader'],
            editableByRoles: ['manager']
          })
        ]
      })
    );

    expect(screen.getByText('Заполняет бухгалтерия')).toBeTruthy();
    expect(screen.getByText('Администратор, Руководитель')).toBeTruthy();
    // «Менеджер» встречается ещё и в чекбоксах диалогов — берём ячейку таблицы
    const editableCell = screen
      .getAllByText('Менеджер')
      .find((el) => el.tagName === 'TD');
    expect(editableCell).toBeTruthy();
  });

  it('в списке типов все 12 значений §11', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();

    const select = within(dialogEl).getByLabelText('Тип поля') as HTMLSelectElement;
    expect(select.options.length).toBe(12);
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Денежная сумма');
    expect(labels).toContain('Множественный выбор');
    expect(labels).toContain('Ссылка');
  });

  it('множественный выбор тоже требует список вариантов', async () => {
    render(React.createElement(CustomFieldsAdmin, { definitions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();

    expect(within(dialogEl).queryByLabelText('Варианты (через запятую)')).toBeNull();
    fireEvent.change(within(dialogEl).getByLabelText('Тип поля'), {
      target: { value: 'multiselect' }
    });
    expect(within(dialogEl).getByLabelText('Варианты (через запятую)')).toBeTruthy();
  });

  it('создание поля отправляет подсказку и отмеченные роли', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(CustomFieldsAdmin, { definitions: [], entity: 'student' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое настраиваемое поле');
    const dialogEl = openDialog();

    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'Табельный номер' } });
    fireEvent.change(within(dialogEl).getByLabelText('Ключ (латиница, a-z0-9_)'), {
      target: { value: 'tab_number' }
    });
    fireEvent.change(within(dialogEl).getByLabelText('Подсказка под полем (необязательно)'), {
      target: { value: '  Из кадрового учёта  ' }
    });

    // чекбоксы ролей: две группы с одинаковыми подписями — берём по id
    fireEvent.click(dialogEl.querySelector('#add-visible-organization') as HTMLElement);
    fireEvent.click(dialogEl.querySelector('#add-editable-manager') as HTMLElement);

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            entityType: 'student',
            key: 'tab_number',
            label: 'Табельный номер',
            fieldType: 'text',
            required: false,
            sortOrder: 0,
            helpText: 'Из кадрового учёта',
            visibleToRoles: ['organization'],
            editableByRoles: ['manager']
          })
        })
      )
    );
  });

  it('правка поля предзаполняет роли и подсказку, тип показан только для чтения', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(CustomFieldsAdmin, {
        definitions: [
          field({
            id: 'f7',
            fieldType: 'money',
            helpText: 'В рублях',
            visibleToRoles: ['admin'],
            editableByRoles: ['leader']
          })
        ]
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить поле');
    const dialogEl = openDialog();

    expect((within(dialogEl).getByLabelText('Тип поля') as HTMLInputElement).value).toBe(
      'Денежная сумма'
    );
    expect((within(dialogEl).getByLabelText('Тип поля') as HTMLInputElement).readOnly).toBe(true);
    expect(
      (within(dialogEl).getByLabelText('Подсказка под полем (необязательно)') as HTMLInputElement)
        .value
    ).toBe('В рублях');
    expect((dialogEl.querySelector('#edit-visible-admin') as HTMLInputElement).checked).toBe(true);
    expect((dialogEl.querySelector('#edit-editable-leader') as HTMLInputElement).checked).toBe(true);
    expect((dialogEl.querySelector('#edit-editable-manager') as HTMLInputElement).checked).toBe(false);

    // снимаем подсказку — уходит null, а не пустая строка
    fireEvent.change(within(dialogEl).getByLabelText('Подсказка под полем (необязательно)'), {
      target: { value: '   ' }
    });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/custom-fields/f7',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            label: 'Срочно',
            options: undefined,
            required: false,
            sortOrder: 1,
            helpText: null,
            visibleToRoles: ['admin'],
            editableByRoles: ['leader']
          })
        })
      )
    );
  });
});
