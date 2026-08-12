'use client';

import React from 'react';

/**
 * Выбор компании для НОВЫХ организаций (`У-50`, прежний Т-41).
 *
 * Один блок на оба файловых канала: с приходом автосоздания (`У-49`) тот же
 * вопрос встал и на вкладке выписки, а две копии разметки разъехались бы по
 * текстам. У администратора своей компании нет (Model A), поэтому он выбирает;
 * руководителю компанию задаёт скоуп сессии — его страница проп не передаёт, и
 * блок не рендерится вовсе. Единственная компания подставляется без вопроса.
 */
export function CompanyPicker({
  companies,
  value,
  onChange,
  idPrefix,
}: {
  companies: Array<{ id: string; name: string }> | undefined;
  value: string;
  onChange: (id: string) => void;
  /** Разные формы на одной странице не должны делить один `id` у поля. */
  idPrefix: string;
}): React.JSX.Element | null {
  if (!companies || companies.length === 0) return null;
  const single = companies.length === 1 ? companies[0] : undefined;
  if (single) {
    return (
      <p className="text-xs text-gray-500" data-testid={`${idPrefix}-company-single`}>
        Новые организации попадут в компанию «{single.name}».
      </p>
    );
  }
  return (
    <div>
      <label
        htmlFor={`${idPrefix}-company`}
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        Компания для новых организаций
      </label>
      <select
        id={`${idPrefix}-company`}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2 bg-white"
        data-testid={`${idPrefix}-company-select`}
      >
        <option value="">— выберите компанию —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
