'use client';
import React, { useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import type { ContactOrgOption } from '@/lib/services/contacts/orgOptions';
import { createOrganizationAction } from '@/server-actions/organizations/create';
import { orgCreateErrorRu } from '@/lib/organizations/createErrors';

/**
 * Организация в форме контакта (этап 6 ТЗ 13.10.2026, `У-309`, `Р-6-9`):
 * найти среди своих по названию или ИНН — или создать новую, не уходя из
 * формы. Новая организация сразу выбрана и закреплена за сотрудником
 * (тот же сервис, что у «Создать организацию», `У-308`).
 */
export function ContactOrgPicker({
  idPrefix,
  options: initialOptions,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  options: ContactOrgOption[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInn, setNewInn] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  // Выбранная организация остаётся в списке и тогда, когда поиск её не находит:
  // иначе выбор молча слетел бы на «Без организации».
  const shown = q
    ? options.filter(
        (o) => o.id === value || o.name.toLowerCase().includes(q) || (o.inn ?? '').startsWith(q)
      )
    : options;

  async function create() {
    const name = newName.trim();
    if (!name) {
      setNote('Укажите название новой организации.');
      return;
    }
    setBusy(true);
    setNote(null);
    const inn = newInn.trim();
    const res = await createOrganizationAction({ name, ...(inn ? { inn } : {}) });
    setBusy(false);
    if (res.ok) {
      setOptions((prev) => [...prev, { id: res.organizationId, name: res.name, inn: inn || null }]);
      onChange(res.organizationId);
      setCreating(false);
      setNewName('');
      setNewInn('');
      setNote(`Организация «${res.name}» создана и выбрана.`);
      return;
    }
    // Такая уже есть среди своих — просто выбираем её, а не плодим вторую.
    const existing =
      res.error === 'org_exists' ? options.find((o) => o.id === res.organizationId) : undefined;
    if (existing) {
      onChange(existing.id);
      setCreating(false);
      setNote(`Такая организация уже есть — выбрали «${existing.name}».`);
      return;
    }
    setNote(orgCreateErrorRu(res.error));
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        htmlFor={`${idPrefix}-org`}
        label="Организация"
        // `У-291`: текст ПМ дословно.
        hint="Сейчас контакт не прикреплен к организации. Привязать его к компании можно позже."
      >
        <Input
          id={`${idPrefix}-org-search`}
          aria-label="Найти организацию по названию или ИНН"
          placeholder="Найти по названию или ИНН"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          className="mb-2"
        />
        <Select
          id={`${idPrefix}-org`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">Без организации</option>
          {shown.map((o) => (
            <option key={o.id} value={o.id}>
              {o.inn ? `${o.name} · ИНН ${o.inn}` : o.name}
            </option>
          ))}
        </Select>
      </Field>
      {q && shown.length === 0 && (
        <p className="text-xs text-gray-500">Среди ваших организаций такой нет — создайте новую.</p>
      )}
      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
          <Field htmlFor={`${idPrefix}-org-new-name`} label="Название новой организации">
            <Input
              id={`${idPrefix}-org-new-name`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={300}
              disabled={busy || disabled}
            />
          </Field>
          <Field htmlFor={`${idPrefix}-org-new-inn`} label="ИНН (если знаете)">
            <Input
              id={`${idPrefix}-org-new-inn`}
              value={newInn}
              onChange={(e) => setNewInn(e.target.value)}
              inputMode="numeric"
              maxLength={12}
              disabled={busy || disabled}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button type="button" onClick={() => void create()} loading={busy}>
              Создать организацию
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-sm text-[#EA580C] hover:underline"
          onClick={() => {
            setCreating(true);
            setNewName(query.trim());
            setNote(null);
          }}
          disabled={disabled}
        >
          Нет в списке? Создать новую
        </button>
      )}
      {note && (
        <p role="status" className="text-xs text-gray-600">
          {note}
        </p>
      )}
    </div>
  );
}
