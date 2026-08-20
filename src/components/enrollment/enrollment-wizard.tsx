'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { pluralizeRu } from '@/lib/format';
import { parseEnrollmentImportAction } from '@/server-actions/enrollment-import';
import { AddStudentDialog } from '@/components/students/add-student-dialog';

/**
 * Мастер подачи заявки на обучение — 3 шага (`У-37`, этап 6):
 * **организация → слушатели и обучения → проверка**.
 *
 * Главное изменение этапа 6: направление уехало с шага 1 **на строку
 * слушателя** (`У-38`). Одной заявкой можно отправить Иванова на
 * электробезопасность, а Петрова — на работы на высоте; один и тот же человек
 * может идти на два разных обучения (`У-35`).
 *
 * Слушатели берутся из справочника сотрудников (`/api/enrollments/students`,
 * этап 5) с поиском; кнопка «Добавить сотрудника» открывает тот же диалог, что
 * в кабинетах, **не выкидывая из мастера** (`У-40`). Массовое назначение:
 * отметить галочками → выбрать обучение → «Назначить отмеченным». Повтор с
 * другим обучением **добавляет** второй набор строк, а не заменяет первый
 * (`У-39`). Импорт из Excel понимает колонку «Направление обучения» (`У-41`).
 */

export type DirectionOption = { id: string; name: string };
export type WizardOrgOption = { id: string; name: string };
type StudentOption = { id: string; name: string; email: string };

type WizardRow = {
  key: string;
  /** id сотрудника организации; у добавленных вручную — null (ФИО/email редактируемы). */
  studentId: string | null;
  /** `У-38`: обучение ЭТОЙ строки. Пустая строка = не выбрано. */
  directionId: string;
  fullName: string;
  email: string;
  position: string;
  snils: string;
  birthDate: string;
  extra: string;
};

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F97316]';
const smallInputCls =
  'w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F97316]';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let rowSeq = 0;
function nextKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

/**
 * Кто такой «этот человек» для проверки повторов: сотрудник справочника — по
 * id, добавленный руками — по почте. Пара «человек + обучение» должна быть
 * уникальной (`У-35`), иначе сервер откажет по уникальному индексу.
 */
function personKey(row: Pick<WizardRow, 'studentId' | 'email'>): string {
  return row.studentId ? `id:${row.studentId}` : `email:${row.email.trim().toLowerCase()}`;
}
function pairKey(row: Pick<WizardRow, 'studentId' | 'email' | 'directionId'>): string {
  return `${personKey(row)}|${row.directionId}`;
}

/** Клиентская проверка позиций перед шагом 3 (сервер перепроверит всё заново). */
export function validateRowsClient(rows: WizardRow[]): string[] {
  const errors: string[] = [];
  if (rows.length === 0) errors.push('Добавьте хотя бы одного слушателя');
  const seenPairs = new Set<string>();
  rows.forEach((row, i) => {
    const label = row.fullName.trim() || `Слушатель ${i + 1}`;
    if (!row.studentId) {
      if (!row.fullName.trim()) errors.push(`Слушатель ${i + 1}: не указано ФИО`);
      if (!row.email.trim()) errors.push(`${label}: не указан email`);
      else if (!EMAIL_RE.test(row.email.trim())) errors.push(`${label}: некорректный email`);
    }
    if (!row.directionId) errors.push(`${label}: не выбрано обучение`);
    const snilsDigits = row.snils.replace(/[\s-]/g, '');
    if (snilsDigits && !/^\d{11}$/.test(snilsDigits)) {
      errors.push(`${label}: СНИЛС должен содержать 11 цифр`);
    }
    // У-35: один человек на одно и то же обучение дважды — это ошибка, а на
    // два разных — норма, поэтому сравниваем пару, а не человека.
    if (row.directionId) {
      const key = pairKey(row);
      if (seenPairs.has(key)) errors.push(`${label}: это обучение уже добавлено ему в заявку`);
      seenPairs.add(key);
    }
  });
  return errors;
}

export function EnrollmentWizard({
  directions,
  organizations,
  defaultOrganizationId,
}: {
  directions: DirectionOption[];
  /** Партнёр/менеджер выбирают организацию; у роли организации — её активная. */
  organizations?: WizardOrgOption[];
  defaultOrganizationId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId ?? '');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<WizardRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Сотрудники выбранной организации. Загрузка выводится из «для какого ключа
  // список уже загружен» — так в эффекте нет синхронных setState
  // (eslint react-hooks/set-state-in-effect). В ключе есть счётчик
  // перезагрузок: после добавления сотрудника (`У-40`) список надо обновить,
  // не меняя организацию.
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkDirectionId, setBulkDirectionId] = useState('');
  const loadKey = `${organizationId}#${reloadSeq}`;
  const studentsLoading = !!organizationId && loadedKey !== loadKey;

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void fetch(`/api/enrollments/students?organizationId=${encodeURIComponent(organizationId)}`)
      .then(async (res) =>
        res.ok ? ((await res.json()) as { students: StudentOption[] }).students : []
      )
      .catch(() => [] as StudentOption[])
      .then((list) => {
        if (cancelled) return;
        setStudents(list);
        setLoadedKey(loadKey);
        // Смена организации делает выбранных сотрудников невалидными — снимаем их.
        setRows((prev) =>
          prev.filter((r) => !r.studentId || list.some((s) => s.id === r.studentId))
        );
        setPicked((prev) => new Set([...prev].filter((id) => list.some((s) => s.id === id))));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, loadKey]);

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    );
  }, [students, search]);

  const orgName = organizations?.find((o) => o.id === organizationId)?.name ?? '';
  const directionName = useCallback(
    (id: string) => directions.find((d) => d.id === id)?.name ?? '',
    [directions]
  );

  /** `У-42`: сводка шага 3 — сколько человек и сколько обучений всего. */
  const summary = useMemo(() => {
    const people = new Set(rows.map(personKey));
    const byDirection = new Map<string, number>();
    for (const r of rows) byDirection.set(r.directionId, (byDirection.get(r.directionId) ?? 0) + 1);
    return {
      people: people.size,
      trainings: rows.length,
      byDirection: [...byDirection.entries()].map(([id, count]) => ({
        id,
        name: directionName(id),
        count,
      })),
    };
  }, [rows, directionName]);

  function togglePicked(id: string, checked: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * `У-39`: назначить отмеченным сотрудникам выбранное обучение. Повтор с
   * другим обучением ДОБАВЛЯЕТ второй набор строк — прежние не трогаем.
   * Пара, которая уже есть, пропускается (`У-35`).
   */
  function assignToPicked() {
    const chosen = students.filter((s) => picked.has(s.id));
    const existing = new Set(rows.map(pairKey));
    const added: WizardRow[] = [];
    let skipped = 0;
    for (const s of chosen) {
      const row: WizardRow = {
        key: nextKey(),
        studentId: s.id,
        directionId: bulkDirectionId,
        fullName: s.name,
        email: s.email,
        position: '',
        snils: '',
        birthDate: '',
        extra: '',
      };
      if (existing.has(pairKey(row))) {
        skipped += 1;
        continue;
      }
      existing.add(pairKey(row));
      added.push(row);
    }
    if (added.length) setRows((prev) => [...prev, ...added]);
    const name = directionName(bulkDirectionId);
    if (added.length) toast.success(`Добавлено обучений «${name}»: ${added.length}`);
    if (skipped) toast.info(`Уже было в заявке: ${skipped}`);
    setPicked(new Set());
  }

  function addManualRow() {
    setRows((prev) => [
      ...prev,
      {
        key: nextKey(),
        studentId: null,
        directionId: '',
        fullName: '',
        email: '',
        position: '',
        snils: '',
        birthDate: '',
        extra: '',
      },
    ]);
  }

  /** `У-38`: «+ ещё обучение» — тот же человек, новая строка с пустым обучением. */
  function addTrainingFor(key: string) {
    setRows((prev) => {
      const src = prev.find((r) => r.key === key);
      /* v8 ignore next -- кнопка живёт внутри самой строки, исходник всегда есть */
      if (!src) return prev;
      const copy: WizardRow = { ...src, key: nextKey(), directionId: '' };
      const at = prev.findIndex((r) => r.key === key);
      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
    });
  }

  function updateRow(key: string, patch: Partial<WizardRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  /** Импорт из Excel: валидные строки — в таблицу, ошибки/дубликаты — списками. */
  async function importFile(file: File) {
    setImportBusy(true);
    setImportErrors([]);
    setImportWarnings([]);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await parseEnrollmentImportAction(form);
      if (!res.ok) {
        setImportErrors(res.errors);
        return;
      }
      const seen = new Set(rows.map(pairKey));
      const added: WizardRow[] = [];
      const warnings = [...res.warnings];
      for (const item of res.items) {
        const row: WizardRow = {
          key: nextKey(),
          studentId: null,
          directionId: item.directionId ?? '',
          fullName: item.fullName,
          email: item.email,
          position: item.position ?? '',
          snils: item.snils ?? '',
          birthDate: item.birthDate ? new Date(item.birthDate).toISOString().slice(0, 10) : '',
          extra: item.extra ?? '',
        };
        if (seen.has(pairKey(row))) {
          warnings.push(`${item.fullName} (${item.email}): это обучение уже в заявке — пропущен`);
          continue;
        }
        seen.add(pairKey(row));
        added.push(row);
      }
      if (added.length) {
        setRows((prev) => [...prev, ...added]);
        toast.success(`Импортировано строк: ${added.length}`);
      }
      setImportErrors(res.errors);
      setImportWarnings(warnings);
    } catch {
      setImportErrors(['Не удалось обработать файл — попробуйте ещё раз']);
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function goToStep3() {
    const found = validateRowsClient(rows);
    setErrors(found);
    if (found.length === 0) setStep(3);
  }

  async function submit() {
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/enrollments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: organizationId || null,
          note: note.trim() || null,
          items: rows.map((r) => ({
            studentId: r.studentId,
            directionId: r.directionId,
            fullName: r.fullName,
            email: r.email,
            position: r.position,
            snils: r.snils,
            birthDate: r.birthDate,
            extra: r.extra,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          messages?: string[];
        };
        if (body.messages?.length) setErrors(body.messages);
        else toast.error(`Не удалось отправить заявку: ${body.error ?? res.status}`);
        return;
      }
      const body = (await res.json()) as { itemCount: number; warnings?: string[] };
      toast.success(`Заявка на обучение отправлена (обучений: ${body.itemCount})`);
      for (const w of body.warnings ?? []) toast.info(w);
      setStep(1);
      setNote('');
      setRows([]);
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  const stepTitle = step === 1 ? 'Организация' : step === 2 ? 'Слушатели и обучения' : 'Проверка';

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-[#111111]">Подать заявку на обучение</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Шаг {step} из 3 — {stepTitle}. Одной заявкой можно отправить сразу нескольких сотрудников
          и на разные обучения.
        </p>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          {organizations && organizations.length > 0 ? (
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Организация</span>
              <select
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className={inputCls}
              >
                <option value="">— без организации —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-gray-500 mt-1">
                От неё зависит список сотрудников на следующем шаге.
              </span>
            </label>
          ) : (
            <p className="text-sm text-gray-600">
              Заявка подаётся от вашей организации — на следующем шаге выберите сотрудников и
              обучения.
            </p>
          )}
          {directions.length === 0 && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Справочник направлений пуст — обратитесь к менеджеру, чтобы направления добавили.
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} disabled={directions.length === 0}>
              Далее: слушатели
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {organizationId ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-700">Сотрудники организации</span>
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск по ФИО или email"
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F97316]"
                  />
                  {/* У-40: тот же диалог, что в кабинетах, но мастер не закрывается —
                      после добавления просто перечитываем список сотрудников. */}
                  <AddStudentDialog
                    organizationId={organizationId}
                    label="+ Добавить сотрудника"
                    onCreated={() => setReloadSeq((n) => n + 1)}
                  />
                </div>
              </div>
              {studentsLoading ? (
                <div className="text-sm text-gray-500">Загружаем сотрудников…</div>
              ) : students.length === 0 ? (
                <div className="text-sm text-gray-500">
                  В справочнике пока нет сотрудников этой организации — добавьте сотрудника кнопкой
                  выше или впишите слушателей строками ниже.
                </div>
              ) : (
                <>
                  <ul className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                    {visibleStudents.map((s) => (
                      <li key={s.id}>
                        <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={picked.has(s.id)}
                            onChange={(e) => togglePicked(s.id, e.target.checked)}
                            className="accent-[#F97316]"
                          />
                          <span className="text-sm text-[#111111]">{s.name}</span>
                          <span className="text-xs text-gray-500">{s.email}</span>
                        </label>
                      </li>
                    ))}
                    {visibleStudents.length === 0 && (
                      <li className="px-3 py-2 text-sm text-gray-500">
                        Никого не нашли по запросу.
                      </li>
                    )}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg p-3">
                    <span className="text-sm text-gray-700">
                      Отмечено: {picked.size}. Назначить им обучение:
                    </span>
                    <select
                      value={bulkDirectionId}
                      onChange={(e) => setBulkDirectionId(e.target.value)}
                      aria-label="Обучение для отмеченных сотрудников"
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F97316]"
                    >
                      <option value="">— выберите обучение —</option>
                      {directions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={assignToPicked}
                      disabled={picked.size === 0 || !bulkDirectionId}
                    >
                      Назначить отмеченным
                    </Button>
                    <span className="w-full text-xs text-gray-500">
                      Можно назначить ещё одно обучение тем же людям — строки добавятся, прежние
                      останутся.
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              Организация не выбрана — добавьте слушателей строками ниже.
            </div>
          )}

          <div className="space-y-2 border border-gray-100 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Импорт из Excel</span>
              <a
                href="/api/enrollments/import-template"
                download
                className="text-sm text-[#F97316] hover:underline"
              >
                Скачать шаблон
              </a>
              <label className="text-sm text-[#F97316] hover:underline cursor-pointer">
                {importBusy ? 'Обрабатываем файл…' : 'Загрузить файл'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  disabled={importBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Заполните шаблон (обязательны ФИО и Email, обучение — колонка «Направление обучения»)
              и загрузите файл.
            </p>
            {importErrors.length > 0 && (
              <ul
                className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5"
                role="alert"
              >
                {importErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {importWarnings.length > 0 && (
              <ul
                className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-0.5"
                role="status"
              >
                {importWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Строк в заявке: {rows.length}
              </span>
              <Button size="sm" variant="secondary" onClick={addManualRow}>
                + Добавить слушателя вручную
              </Button>
            </div>
            {rows.length === 0 && (
              <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">
                Пока пусто. Отметьте сотрудников галочками и назначьте им обучение — или впишите
                слушателя вручную.
              </div>
            )}
            {rows.map((row, i) => (
              <div key={row.key} className="border border-gray-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    Строка {i + 1}
                    {row.studentId && <span className="ml-2 text-emerald-700">из сотрудников</span>}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => addTrainingFor(row.key)}
                      className="text-xs text-[#F97316] hover:underline"
                    >
                      + ещё обучение
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
                <label className="block">
                  <span className="block text-[11px] text-gray-500 mb-0.5">Обучение *</span>
                  <select
                    value={row.directionId}
                    onChange={(e) => updateRow(row.key, { directionId: e.target.value })}
                    aria-label={`Обучение для строки ${i + 1}`}
                    className={smallInputCls}
                  >
                    <option value="">— выберите обучение —</option>
                    {directions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={row.fullName}
                    onChange={(e) => updateRow(row.key, { fullName: e.target.value })}
                    placeholder="ФИО *"
                    disabled={!!row.studentId}
                    className={`${smallInputCls} disabled:bg-gray-50 disabled:text-gray-500`}
                  />
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => updateRow(row.key, { email: e.target.value })}
                    placeholder="Email *"
                    disabled={!!row.studentId}
                    className={`${smallInputCls} disabled:bg-gray-50 disabled:text-gray-500`}
                  />
                  <input
                    type="text"
                    value={row.position}
                    onChange={(e) => updateRow(row.key, { position: e.target.value })}
                    placeholder="Должность"
                    className={smallInputCls}
                  />
                  <input
                    type="text"
                    value={row.snils}
                    onChange={(e) => updateRow(row.key, { snils: e.target.value })}
                    placeholder="СНИЛС (11 цифр)"
                    className={smallInputCls}
                  />
                  <label className="block">
                    <span className="block text-[11px] text-gray-500 mb-0.5">Дата рождения</span>
                    <input
                      type="date"
                      value={row.birthDate}
                      onChange={(e) => updateRow(row.key, { birthDate: e.target.value })}
                      className={smallInputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-gray-500 mb-0.5">Дополнительно</span>
                    <input
                      type="text"
                      value={row.extra}
                      onChange={(e) => updateRow(row.key, { extra: e.target.value })}
                      placeholder="Любая дополнительная информация"
                      className={smallInputCls}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          {errors.length > 0 && (
            <ul
              className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5"
              role="alert"
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Назад
            </Button>
            <Button onClick={goToStep3} disabled={rows.length === 0}>
              Далее: проверка
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1">
            {/* У-42: сводка «N слушателей · M обучений» + разбивка по обучениям. */}
            <div className="font-medium text-[#111111]">
              {summary.people} {pluralizeRu(summary.people, 'слушатель', 'слушателя', 'слушателей')}{' '}
              · {summary.trainings}{' '}
              {pluralizeRu(summary.trainings, 'обучение', 'обучения', 'обучений')}
            </div>
            {orgName && <div>Организация: {orgName}</div>}
            <ul className="text-xs text-gray-600">
              {summary.byDirection.map((d) => (
                <li key={d.id}>
                  {d.name}: {d.count} {pluralizeRu(d.count, 'слушатель', 'слушателя', 'слушателей')}
                </li>
              ))}
            </ul>
          </div>
          <ul className="text-sm text-gray-700 border border-gray-100 rounded-lg divide-y divide-gray-50">
            {rows.map((r, i) => (
              <li key={r.key} className="px-3 py-2">
                {/* Без запасного «—»: валидация шага 2 не пускает на итог позицию
                    без ФИО, поэтому fallback был недостижим (Ф4 программы покрытия). */}
                <span className="font-medium text-[#111111]">
                  {i + 1}. {r.fullName}
                </span>{' '}
                <span className="text-xs text-gray-500">{r.email}</span>
                <span className="text-xs text-[#F97316]"> · {directionName(r.directionId)}</span>
                {r.position && <span className="text-xs text-gray-500"> · {r.position}</span>}
              </li>
            ))}
          </ul>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Примечание к заявке (необязательно)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </label>

          {errors.length > 0 && (
            <ul
              className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5"
              role="alert"
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={busy}>
              Назад
            </Button>
            <Button onClick={submit} loading={busy}>
              Отправить заявку
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
