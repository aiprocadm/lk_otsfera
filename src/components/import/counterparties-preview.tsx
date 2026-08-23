'use client';

import React from 'react';
import { Input } from '@/components/ui';
import { isValidInn, normalizeInn } from '@/lib/services/oneCSync/inn';
import type {
  CounterpartyOverride,
  NewCounterparty,
} from '@/lib/services/import/oneCAccountCard/new-counterparties';

/**
 * Кого именно заведёт импорт (`У-87`).
 *
 * Три группы вместо плоского списка: «ИНН из файла», «ИНН найден в ЕГРЮЛ» и
 * «без ИНН». Разница существенная — в первой человек ничего не проверяет, во
 * второй решение принял справочник (поэтому рядом показано название из
 * реестра), в третьей организация заведётся с пустым реквизитом. У каждой
 * строки — галочка «создавать» и поле ИНН: решение человека последнее, а
 * негодный ИНН он видит здесь, до применения, а не в отказе после.
 */
type Group = { id: 'file' | 'dadata' | 'none'; title: string; hint: string };

const GROUPS: Group[] = [
  {
    id: 'file',
    title: 'ИНН из файла',
    hint: 'ИНН напечатан в выписке — проверять нечего.',
  },
  {
    id: 'dadata',
    title: 'ИНН найден в ЕГРЮЛ',
    hint: 'Совпало ровно одно действующее юрлицо с таким названием. Сверьте название из реестра.',
  },
  {
    id: 'none',
    title: 'Без ИНН',
    hint: 'Организация заведётся по названию. ИНН можно вписать здесь или позже в карточке.',
  },
];

function groupOf(c: NewCounterparty): Group['id'] {
  if (c.innSource === 'file') return 'file';
  if (c.innSource === 'dadata') return 'dadata';
  return 'none';
}

export function CounterpartiesPreview({
  list,
  overrides,
  onChange,
}: {
  list: NewCounterparty[];
  overrides: CounterpartyOverride[];
  onChange: (next: CounterpartyOverride[]) => void;
}) {
  if (list.length === 0) return null;

  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const isCreating = (c: NewCounterparty) => byKey.get(c.key)?.create !== false;
  const innOf = (c: NewCounterparty) => byKey.get(c.key)?.inn ?? c.inn ?? '';
  const willCreate = list.filter(isCreating).length;

  function put(key: string, patch: Partial<CounterpartyOverride>) {
    const next = overrides.filter((o) => o.key !== key);
    const merged = { ...(byKey.get(key) ?? {}), key, ...patch };
    next.push(merged as CounterpartyOverride);
    onChange(next);
  }

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4"
      data-testid="payment-import-new-counterparties"
    >
      <h3 className="text-sm font-semibold text-[#111111]">
        {`Будет создано организаций: ${willCreate}`}
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Таких организаций в системе нет — импорт заведёт их сам, и платежи привяжутся к ним. Снимите
        галочку, чтобы строки контрагента ушли в очередь ручного разбора; импорт целиком можно
        отменить на вкладке «История».
      </p>

      {GROUPS.map((g) => {
        const rows = list.filter((c) => groupOf(c) === g.id);
        if (rows.length === 0) return null;
        return (
          <section key={g.id} className="mt-3" data-testid={`cp-group-${g.id}`}>
            <h4 className="text-xs font-semibold text-[#111111]">{`${g.title} — ${rows.length}`}</h4>
            <p className="text-xs text-gray-500">{g.hint}</p>
            <ul className="mt-1 space-y-1">
              {rows.map((c) => {
                const value = innOf(c);
                const bad = value.trim() !== '' && !isValidInn(normalizeInn(value));
                return (
                  <li
                    key={c.key}
                    className="flex flex-wrap items-center gap-2 text-xs text-gray-700"
                    data-testid={`cp-row-${c.key}`}
                  >
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={isCreating(c)}
                        onChange={(e) => put(c.key, { create: e.target.checked })}
                      />
                      <span className="font-medium text-[#111111]">{c.name || 'без названия'}</span>
                    </label>
                    {c.egrulName && c.egrulName !== c.name && (
                      <span className="text-gray-500">{`в ЕГРЮЛ: ${c.egrulName}`}</span>
                    )}
                    <span className="text-gray-500">{`строк: ${c.rows}`}</span>
                    <Input
                      aria-label={`ИНН — ${c.name || c.key}`}
                      value={value}
                      placeholder="ИНН (необязательно)"
                      className="w-44"
                      onChange={(e) => put(c.key, { inn: e.target.value })}
                    />
                    {bad && (
                      <span role="alert" className="text-red-600">
                        ИНН должен быть из 10 или 12 цифр с верной контрольной суммой
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
