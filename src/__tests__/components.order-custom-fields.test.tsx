import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// Client component uses Next.js hooks — stub them for server-render test harness
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Stub server-action (not exercised in render tests)
vi.mock('@/server-actions/customFields', () => ({ saveCustomFieldsAction: vi.fn() }));
// Stub sonner toast
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import type { FieldWithValue } from '@/lib/services/customFields';

// ─── fixtures ────────────────────────────────────────────────────────────────

const textField: FieldWithValue = {
  definition: {
    id: 'def-text',
    key: 'project_code',
    label: 'Код проекта',
    fieldType: 'text',
    options: [],
    required: false,
    sortOrder: 1, helpText: null, editable: true
  },
  value: 'ABC-123',
};

const boolField: FieldWithValue = {
  definition: {
    id: 'def-bool',
    key: 'urgent',
    label: 'Срочный',
    fieldType: 'boolean',
    options: [],
    required: false,
    sortOrder: 2, helpText: null, editable: true
  },
  value: 'true',
};

const boolFieldFalse: FieldWithValue = { ...boolField, value: 'false' };

const dateField: FieldWithValue = {
  definition: {
    id: 'def-date',
    key: 'deadline',
    label: 'Дедлайн',
    fieldType: 'date',
    options: [],
    required: false,
    sortOrder: 3, helpText: null, editable: true
  },
  value: '2026-07-01',
};

const selectField: FieldWithValue = {
  definition: {
    id: 'def-select',
    key: 'priority',
    label: 'Приоритет',
    fieldType: 'select',
    options: ['Низкий', 'Высокий'],
    required: true,
    sortOrder: 4, helpText: null, editable: true
  },
  value: 'Высокий',
};

const nullValueField: FieldWithValue = { ...textField, value: null };

// ─── empty → nothing ─────────────────────────────────────────────────────────

describe('OrderCustomFields — empty fields', () => {
  it('рендерит null (ничего) когда fields пустой массив', () => {
    const html = renderToString(
      <OrderCustomFields fields={[]} orderId='o1' editable={false} />
    );
    expect(html).toBe('');
  });
});

// ─── read-only mode ───────────────────────────────────────────────────────────

describe('OrderCustomFields — read-only (editable=false)', () => {
  it('показывает заголовок секции', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={false} />
    );
    expect(html).toContain('Дополнительные поля');
  });

  it('показывает label и текстовое значение', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={false} />
    );
    expect(html).toContain('Код проекта');
    expect(html).toContain('ABC-123');
  });

  it('boolean true → «Да»', () => {
    const html = renderToString(
      <OrderCustomFields fields={[boolField]} orderId='o1' editable={false} />
    );
    expect(html).toContain('Да');
    expect(html).not.toContain('Нет');
  });

  it('boolean false → «Нет»', () => {
    const html = renderToString(
      <OrderCustomFields fields={[boolFieldFalse]} orderId='o1' editable={false} />
    );
    expect(html).toContain('Нет');
  });

  it('date value отформатирован как DD.MM.YYYY', () => {
    const html = renderToString(
      <OrderCustomFields fields={[dateField]} orderId='o1' editable={false} />
    );
    // fmtDate formats as DD.MM.YYYY in ru-RU locale
    expect(html).toContain('01.07.2026');
  });

  it('null value показывает «—»', () => {
    const html = renderToString(
      <OrderCustomFields fields={[nullValueField]} orderId='o1' editable={false} />
    );
    expect(html).toContain('—');
  });

  it('НЕ рендерит кнопку «Сохранить»', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={false} />
    );
    expect(html).not.toContain('Сохранить поля');
  });
});

// ─── edit mode ───────────────────────────────────────────────────────────────

describe('OrderCustomFields — edit mode (editable=true)', () => {
  it('показывает заголовок секции', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('Дополнительные поля');
  });

  it('рендерит текстовый input с предзаполненным значением', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('type="text"');
    expect(html).toContain('ABC-123');
  });

  it('рендерит date input', () => {
    const html = renderToString(
      <OrderCustomFields fields={[dateField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('type="date"');
  });

  it('рендерит select с options для select-поля', () => {
    const html = renderToString(
      <OrderCustomFields fields={[selectField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('<select');
    expect(html).toContain('Низкий');
    expect(html).toContain('Высокий');
  });

  it('рендерит checkbox для boolean-поля', () => {
    const html = renderToString(
      <OrderCustomFields fields={[boolField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Срочный');
  });

  it('показывает кнопку «Сохранить поля»', () => {
    const html = renderToString(
      <OrderCustomFields fields={[textField]} orderId='o1' editable={true} />
    );
    expect(html).toContain('Сохранить поля');
  });

  it('required поле помечается звёздочкой', () => {
    const html = renderToString(
      <OrderCustomFields fields={[selectField]} orderId='o1' editable={true} />
    );
    // Label + required asterisk
    expect(html).toContain('Приоритет');
    expect(html).toContain('*');
  });
});
