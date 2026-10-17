'use client';
import React, { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { staffRoleLabel, type StaffColleagueVM } from './staff-colleague';

/**
 * «+ Новый чат» команды (этап 7 ТЗ 13.10.2026, `У-315`, `Р-7-3`): название и
 * участники из коллег своей компании. Права и состав проверяет сервер
 * (`createGroupChat`); форма лишь собирает выбор.
 */
export function StaffNewGroupForm({
  colleagues,
  onCreate,
  onCancel,
}: {
  colleagues: StaffColleagueVM[];
  onCreate: (title: string, participantIds: string[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? colleagues.filter((c) => c.name.toLowerCase().includes(q)) : colleagues;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setHint('Назовите чат.');
    if (picked.size === 0) return setHint('Отметьте хотя бы одного коллегу.');
    setBusy(true);
    setHint(null);
    const ok = await onCreate(title.trim(), [...picked]);
    setBusy(false);
    if (ok) {
      setTitle('');
      setPicked(new Set());
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Новый чат команды"
      className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2 text-sm"
    >
      <Input
        aria-label="Название чата"
        placeholder="Название, например «Отдел продаж»"
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
      />
      <Input
        aria-label="Найти коллегу"
        placeholder="Найти коллегу"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
      />
      <ul className="max-h-40 overflow-y-auto" aria-label="Участники">
        {shown.length === 0 ? (
          <li className="px-1 py-1 text-xs text-gray-400">Никого не нашли</li>
        ) : (
          shown.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 px-1 py-0.5">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  disabled={busy}
                />
                <span>{c.name}</span>
                {c.role && (
                  <span className="text-xs text-gray-500">· {staffRoleLabel(c.role)}</span>
                )}
              </label>
            </li>
          ))
        )}
      </ul>
      {hint && (
        <p role="status" className="text-xs text-red-600">
          {hint}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          Создать чат
        </Button>
      </div>
    </form>
  );
}
