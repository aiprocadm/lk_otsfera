// @vitest-environment jsdom
/**
 * §11 ТЗ v0.5, этап 1 PR-3 — секция «Дополнительные поля» на карточке любой
 * сущности. Здесь проверяются контролы всех 12 типов, подсказка и главное —
 * что право правки берётся **из каждого поля**, а не из кабинета.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FieldWithValue } from '@/lib/services/customFields';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { saveCustomFieldsAction } = vi.hoisted(() => ({ saveCustomFieldsAction: vi.fn() }));
vi.mock('@/server-actions/customFields', () => ({ saveCustomFieldsAction }));

import { EntityCustomFields, formatValue } from '@/components/custom-fields/entity-custom-fields';

function fwv(
  over: Partial<FieldWithValue['definition']> & { id: string },
  value: string | null = null
): FieldWithValue {
  return {
    definition: {
      key: over.id,
      label: 'Поле',
      fieldType: 'text',
      options: [],
      required: false,
      sortOrder: 1,
      helpText: null,
      editable: true,
      ...over
    },
    value
  };
}

describe('EntityCustomFields — пустое состояние и режимы', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    saveCustomFieldsAction.mockReset();
  });

  it('без полей секция не рендерится вовсе', () => {
    const { container } = render(
      <EntityCustomFields fields={[]} entityType='organization' entityId='o1' />
    );
    expect(container.innerHTML).toBe('');
  });

  it('нет ни одного поля с правом правки → показ без формы', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Куратор', editable: false }, 'Иванов')]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect(screen.getByText('Куратор')).toBeTruthy();
    expect(screen.getByText('Иванов')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить поля' })).toBeNull();
  });

  it('смешанный случай: правимое — контролом, остальное — значением', () => {
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Комментарий', editable: true }, 'текст'),
          fwv({ id: 'd2', label: 'Только чтение', editable: false }, 'значение')
        ]}
        entityType='partner'
        entityId='p1'
      />
    );
    expect((screen.getByLabelText('Комментарий') as HTMLInputElement).value).toBe('текст');
    // неправимое поле показано значением, а не заблокированным контролом
    expect(screen.queryByLabelText('Только чтение')).toBeNull();
    expect(screen.getByText('значение')).toBeTruthy();
  });

  it('заголовок секции переопределяется', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1' })]}
        entityType='student'
        entityId='s1'
        title='Кадровые данные'
      />
    );
    expect(screen.getByText('Кадровые данные')).toBeTruthy();
  });

  it('подсказка выводится под контролом', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'СНИЛС', helpText: 'Только цифры' })]}
        entityType='student'
        entityId='s1'
      />
    );
    expect(screen.getByText('Только цифры')).toBeTruthy();
  });
});

describe('EntityCustomFields — контролы 12 типов', () => {
  it('многострочный текст — textarea', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Заметка', fieldType: 'textarea' }, 'строка')]}
        entityType='organization'
        entityId='o1'
      />
    );
    const el = screen.getByLabelText('Заметка');
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('денежная сумма — текстовое поле с числовой клавиатурой', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Сумма', fieldType: 'money' }, '100.50')]}
        entityType='organization'
        entityId='o1'
      />
    );
    const el = screen.getByLabelText('Сумма') as HTMLInputElement;
    expect(el.type).toBe('text');
    expect(el.inputMode).toBe('decimal');
  });

  it.each([
    ['datetime', 'datetime-local'],
    ['phone', 'tel'],
    ['email', 'email'],
    ['url', 'url'],
    ['date', 'date'],
    ['number', 'number'],
    ['text', 'text']
  ])('тип %s → input type=%s', (fieldType, inputType) => {
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Поле X', fieldType: fieldType as 'text' })
        ]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText('Поле X') as HTMLInputElement).type).toBe(inputType);
  });

  it('выбор одного — список с пустым вариантом', () => {
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Приоритет', fieldType: 'select', options: ['низкий', 'высокий'] })
        ]}
        entityType='organization'
        entityId='o1'
      />
    );
    const select = screen.getByLabelText('Приоритет') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      '— выберите —',
      'низкий',
      'высокий'
    ]);
  });

  it('да/нет — галочка', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Срочно', fieldType: 'boolean' }, 'true')]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText('Срочно') as HTMLInputElement).checked).toBe(true);
  });

  it('множественный выбор — группа галочек, отмечены сохранённые', () => {
    render(
      <EntityCustomFields
        fields={[
          fwv(
            { id: 'd1', label: 'Направления', fieldType: 'multiselect', options: ['ОТ', 'ПБ', 'ЭБ'] },
            '["ОТ","ЭБ"]'
          )
        ]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText('ОТ') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('ПБ') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('ЭБ') as HTMLInputElement).checked).toBe(true);
  });

  it('битое значение множественного выбора не роняет форму — просто ничего не отмечено', () => {
    render(
      <EntityCustomFields
        fields={[
          fwv(
            { id: 'd1', label: 'Направления', fieldType: 'multiselect', options: ['ОТ', 'ПБ'] },
            'не json'
          )
        ]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText('ОТ') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('ПБ') as HTMLInputElement).checked).toBe(false);
  });

  it('обязательное поле помечено звёздочкой', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'ИНН', required: true })]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText(/ИНН/) as HTMLInputElement).required).toBe(true);
  });

  it('обязательная галочка требует отметки, пока значение не задано', () => {
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Согласовано', fieldType: 'boolean', required: true })]}
        entityType='organization'
        entityId='o1'
      />
    );
    expect((screen.getByLabelText(/Согласовано/) as HTMLInputElement).required).toBe(true);
  });
});

describe('EntityCustomFields — сохранение', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    saveCustomFieldsAction.mockReset();
  });

  it('передаёт сущность, запись и значения; пустое уходит как null', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Комментарий' }, 'было'),
          fwv({ id: 'd2', label: 'Пусто' }, '')
        ]}
        entityType='student'
        entityId='s7'
      />
    );

    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'стало' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('student', 's7', {
        d1: 'стало',
        d2: null
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Дополнительные поля сохранены.'));
    expect(refresh).toHaveBeenCalled();
  });

  it('неправимые поля в запрос не попадают', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Мой' }, 'да'),
          fwv({ id: 'd2', label: 'Чужой', editable: false }, 'нет')
        ]}
        entityType='partner'
        entityId='p1'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('partner', 'p1', { d1: 'да' })
    );
  });

  it('множественный выбор: отметка и снятие меняют состав, пустой набор = очистка', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(
      <EntityCustomFields
        fields={[
          fwv(
            { id: 'd1', label: 'Направления', fieldType: 'multiselect', options: ['ОТ', 'ПБ'] },
            '["ОТ"]'
          )
        ]}
        entityType='organization'
        entityId='o1'
      />
    );

    fireEvent.click(screen.getByLabelText('ПБ')); // добавили
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));
    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('organization', 'o1', {
        d1: '["ОТ","ПБ"]'
      })
    );

    saveCustomFieldsAction.mockClear();
    fireEvent.click(screen.getByLabelText('ОТ')); // сняли
    fireEvent.click(screen.getByLabelText('ПБ')); // сняли последнее
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));
    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('organization', 'o1', { d1: null })
    );
  });

  it('галочка да/нет переключается в обе стороны', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Срочно', fieldType: 'boolean' }, 'false')]}
        entityType='organization'
        entityId='o1'
      />
    );

    fireEvent.click(screen.getByLabelText('Срочно'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));
    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('organization', 'o1', { d1: 'true' })
    );
  });

  it('список и многострочный текст доезжают до экшена', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(
      <EntityCustomFields
        fields={[
          fwv({ id: 'd1', label: 'Приоритет', fieldType: 'select', options: ['низкий', 'высокий'] }),
          fwv({ id: 'd2', label: 'Заметка', fieldType: 'textarea' })
        ]}
        entityType='organization'
        entityId='o1'
      />
    );

    fireEvent.change(screen.getByLabelText('Приоритет'), { target: { value: 'высокий' } });
    fireEvent.change(screen.getByLabelText('Заметка'), { target: { value: 'две\nстроки' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() =>
      expect(saveCustomFieldsAction).toHaveBeenCalledWith('organization', 'o1', {
        d1: 'высокий',
        d2: 'две\nстроки'
      })
    );
  });

  it('отказ сервера показывает русскую ошибку и не обновляет страницу', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(
      <EntityCustomFields
        fields={[fwv({ id: 'd1', label: 'Поле' }, 'x')]}
        entityType='organization'
        entityId='o1'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('formatValue — показ значений', () => {
  it('пусто и null дают прочерк', () => {
    expect(formatValue(fwv({ id: 'd' }, null))).toBe('—');
    expect(formatValue(fwv({ id: 'd' }, ''))).toBe('—');
  });

  it('да/нет по-русски', () => {
    expect(formatValue(fwv({ id: 'd', fieldType: 'boolean' }, 'true'))).toBe('Да');
    expect(formatValue(fwv({ id: 'd', fieldType: 'boolean' }, 'false'))).toBe('Нет');
  });

  it('деньги с рублём, множественный выбор через запятую', () => {
    expect(formatValue(fwv({ id: 'd', fieldType: 'money' }, '1500.00'))).toBe('1500.00 ₽');
    expect(formatValue(fwv({ id: 'd', fieldType: 'multiselect' }, '["ОТ","ПБ"]'))).toBe('ОТ, ПБ');
  });

  it('битый multiselect показывается как есть, а не роняет карточку', () => {
    expect(formatValue(fwv({ id: 'd', fieldType: 'multiselect' }, 'не json'))).toBe('не json');
  });

  it('дата и время выводятся по-человечески, мусор — как есть', () => {
    const out = formatValue(fwv({ id: 'd', fieldType: 'datetime' }, '2026-12-31T10:05:00Z'));
    expect(out).toMatch(/\d{2}:\d{2}$/);
    expect(formatValue(fwv({ id: 'd', fieldType: 'datetime' }, 'вчера'))).toBe('вчера');
  });

  it('обычный текст без изменений', () => {
    expect(formatValue(fwv({ id: 'd' }, 'как есть'))).toBe('как есть');
  });
});
