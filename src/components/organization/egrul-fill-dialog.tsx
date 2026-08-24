'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { fillOrgFromEgrulAction } from '@/server-actions/organization/egrul';
import { EGRUL_FIELDS, EGRUL_FIELD_LABELS, type EgrulField } from '@/lib/services/organization/egrul';

/**
 * «Найти в ЕГРЮЛ» — подстановка реквизитов организации по названию (`У-94`).
 *
 * Организации, заведённые импортом выписки, приходят без ИНН, и раньше его
 * приходилось искать на стороннем сайте и вбивать руками.
 *
 * **Каждое поле — с галочкой.** Человек мог уже внести часть данных сам;
 * подсказка не должна затирать его работу, поэтому подставляется ровно то, что
 * он отметил. Снятые галочки до сервера не доходят вовсе.
 */
type Suggestion = {
  name: string;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  address: string | null;
  status: string | null;
  opf: string | null;
};

const ERRORS: Record<string, string> = {
  forbidden: 'Нет прав на изменение этой организации.',
  not_found: 'Организация не найдена.',
  nothing_selected: 'Отметьте хотя бы одно поле.',
  inn_taken: 'Этот ИНН уже занят другой организацией вашей компании.',
  validation: 'Проверьте выбранные поля.',
};

/** Значение поля у подсказки: одна карта на показ, отправку и галочки. */
function valueOf(s: Suggestion, field: EgrulField): string | null {
  switch (field) {
    case 'inn':
      return s.inn;
    case 'kpp':
      return s.kpp;
    case 'legalName':
      return s.name;
    case 'ogrn':
      return s.ogrn;
    case 'legalAddress':
      return s.address;
  }
}

export function EgrulFillDialog({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(organizationName);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setItems([]);
    setPicked(null);
    setChecked({});
    setError(null);
    setSearched(false);
  }

  async function search() {
    const q = query.trim();
    if (q.length < 2) {
      setError('Введите хотя бы два символа названия.');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggest/party?query=${encodeURIComponent(q)}`);
      const body = (await res.json()) as { suggestions?: Suggestion[] };
      setItems(body.suggestions ?? []);
      setPicked(null);
      setChecked({});
      setSearched(true);
    } catch {
      // Подсказки — вспомогательный путь: их отсутствие не должно ломать экран.
      setItems([]);
      setSearched(true);
      setError('Не удалось получить подсказки. Реквизиты можно внести вручную.');
    } finally {
      setSearching(false);
    }
  }

  function choose(index: number) {
    const s = items[index];
    if (!s) return;
    setPicked(index);
    // По умолчанию отмечены все поля, которые подсказка вообще знает.
    const next: Record<string, boolean> = {};
    for (const field of EGRUL_FIELDS) next[field] = valueOf(s, field) !== null;
    setChecked(next);
  }

  function submit() {
    const s = picked !== null ? items[picked] : undefined;
    if (!s) return;
    const values: Record<string, string> = {};
    for (const field of EGRUL_FIELDS) {
      const v = valueOf(s, field);
      if (checked[field] && v) values[field] = v;
    }
    setError(null);
    startTransition(async () => {
      const res = await fillOrgFromEgrulAction({ organizationId, values });
      if (!res.ok) {
        setError(ERRORS[res.error] ?? 'Не удалось заполнить реквизиты.');
        return;
      }
      setOpen(false);
      reset();
      toast.success(`Заполнено полей: ${res.filled.length}.`);
      router.refresh();
    });
  }

  const current = picked !== null ? items[picked] : undefined;

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setQuery(organizationName);
          reset();
          setOpen(true);
        }}
      >
        Найти в ЕГРЮЛ
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Найти организацию в ЕГРЮЛ"
        size="xl"
        busy={pending}
        {...(error ? { error } : {})}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Найдём организацию по названию и подставим её реквизиты. Отметьте галочками только те
            поля, которые нужно заполнить, — уже внесённое вручную не затрётся.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[16rem]">
              <span className="block text-sm text-gray-700 mb-1">Название организации</span>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <Button type="button" onClick={search} disabled={searching || pending}>
              {searching ? 'Ищу…' : 'Найти'}
            </Button>
          </div>

          {searched && items.length === 0 && (
            <p className="text-sm text-gray-500">
              Ничего не нашлось. Уточните название или внесите реквизиты вручную на вкладке
              «Настройки».
            </p>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {items.map((s, i) => (
                <li key={`${s.inn}-${i}`}>
                  <label className="flex items-start gap-3 px-3 py-2 cursor-pointer">
                    <input
                      type="radio"
                      name="egrul-suggestion"
                      checked={picked === i}
                      onChange={() => choose(i)}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-[#111111]">{s.name}</span>
                      <span className="block text-xs text-gray-500">
                        ИНН {s.inn}
                        {s.address ? ` · ${s.address}` : ''}
                        {/* Состояние по ЕГРЮЛ: ликвидированного тёзку легко
                            принять за нужную организацию. */}
                        {s.status && s.status !== 'ACTIVE' ? ' · не действует' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {current && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[#111111] mb-1">Что заполнить</legend>
              {EGRUL_FIELDS.map((field) => {
                const value = valueOf(current, field);
                return (
                  <label
                    key={field}
                    className={`flex items-start gap-3 text-sm ${value ? '' : 'opacity-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!checked[field] && !!value}
                      disabled={!value}
                      onChange={(e) => setChecked((p) => ({ ...p, [field]: e.target.checked }))}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-gray-700">{EGRUL_FIELD_LABELS[field]}: </span>
                      <span className="text-[#111111]">{value ?? 'нет в ЕГРЮЛ'}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={submit} disabled={!current || pending}>
              {pending ? 'Заполняю…' : 'Заполнить'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
