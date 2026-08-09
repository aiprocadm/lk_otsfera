'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { createStudentAction } from '@/server-actions/students';
import type { DuplicateCandidate, DuplicateMatch } from '@/lib/services/students/duplicates';

/**
 * Добавление сотрудника (`У-24`…`У-26`, `У-63`, этап 5 ТЗ понятности).
 *
 * Один диалог на четыре кабинета: организация, портфель партнёра, карточка
 * организации у менеджера и у администратора. Компонент строго
 * презентационный — знает только `organizationId`; все права проверяет сервер
 * (CLAUDE.md §4), поэтому одна и та же кнопка безопасна во всех кабинетах.
 *
 * Дубль (`У-22`) не блокирует ввод: показываем найденных и даём выбор
 * «Всё равно добавить». Однофамильцы существуют.
 */
const MATCH_LABEL: Record<DuplicateMatch, string> = {
  snils: 'по СНИЛС',
  name_birthdate: 'по ФИО и дате рождения',
  name_email: 'по ФИО и почте',
};

export function AddStudentDialog({
  organizationId,
  label = 'Добавить сотрудника',
}: {
  organizationId: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{
    match: DuplicateMatch;
    candidates: DuplicateCandidate[];
  } | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
    setDuplicates(null);
  }

  async function submit(fd: FormData, force: boolean) {
    setBusy(true);
    setError(null);
    try {
      fd.set('organizationId', organizationId);
      if (force) fd.set('force', '1');

      const res = await createStudentAction(fd);

      if (res.ok) {
        toast.success('Сотрудник добавлен');
        setOpen(false);
        setDuplicates(null);
        router.refresh();
        return;
      }
      if (res.error === 'duplicate_found') {
        setDuplicates({ match: res.match, candidates: res.candidates });
        return;
      }
      if (res.error === 'validation') {
        setError(res.messages?.join('. ') ?? 'Проверьте заполнение полей.');
        return;
      }
      setError(
        res.error === 'forbidden'
          ? 'Нет прав добавлять сотрудников в эту организацию.'
          : 'Не удалось добавить сотрудника. Попробуйте ещё раз.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="add-student-open">
        {label}
      </Button>

      <Dialog open={open} onClose={close} title="Новый сотрудник" size="md" busy={busy}>
        <form
          data-testid="add-student-form"
          action={(fd) => {
            void submit(fd, false);
          }}
          className="space-y-3"
        >
          <Field label="ФИО" htmlFor="st-name" hint="Единственное обязательное поле">
            <Input id="st-name" name="name" required placeholder="Иванов Иван Иванович" />
          </Field>
          <Field label="Должность" htmlFor="st-position">
            <Input id="st-position" name="position" placeholder="Электромонтёр" />
          </Field>
          <Field label="СНИЛС" htmlFor="st-snils">
            <Input id="st-snils" name="snils" placeholder="112-233-445 95" />
          </Field>
          <Field label="Дата рождения" htmlFor="st-birth">
            <Input id="st-birth" name="birthDate" type="date" />
          </Field>
          <Field label="Почта" htmlFor="st-email">
            {/* У-21: почта необязательна — рабочих обучают без корпоративной. */}
            <Input id="st-email" name="email" type="email" placeholder="можно не указывать" />
          </Field>
          <Field label="Телефон" htmlFor="st-phone">
            <Input id="st-phone" name="phone" placeholder="+7 900 000-00-00" />
          </Field>
          <Field label="Заметка" htmlFor="st-note">
            <Input id="st-note" name="note" placeholder="Например: работает в цехе №3" />
          </Field>

          {error && (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          {duplicates && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2"
              data-testid="add-student-duplicates"
            >
              <p className="text-sm font-medium text-amber-900">
                Такой сотрудник уже есть — совпадение {MATCH_LABEL[duplicates.match]}.
              </p>
              <ul className="text-xs text-amber-900 space-y-0.5">
                {duplicates.candidates.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    {c.position ? ` · ${c.position}` : ''}
                    {c.status !== 'active' ? ' · деактивирован' : ''}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-800">
                Можно закрыть окно и работать с существующим сотрудником — или всё равно добавить
                нового, если это однофамилец.
              </p>
              <Button
                type="submit"
                variant="secondary"
                disabled={busy}
                data-testid="add-student-force"
                formAction={(fd) => {
                  void submit(fd, true);
                }}
              >
                Всё равно добавить
              </Button>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy} data-testid="add-student-submit">
              {busy ? 'Сохраняю…' : 'Добавить'}
            </Button>
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              Отмена
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
