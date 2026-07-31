'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { parseEnrollmentImportAction } from '@/server-actions/enrollment-import';

/**
 * Мастер подачи заявки на обучение (этап 2, ФТ-2.1) — 3 шага:
 * направление → слушатели → проверка. Shared presentational для всех ролей
 * подачи (как прежняя форма — сознательное исключение из sibling-паттерна:
 * форма идентична по ролям, сервер сам выводит скоуп из сессии).
 *
 * Слушатели: чекбоксы из сотрудников организации (/api/enrollments/students)
 * + добавление строками + импорт из Excel (шаблон — /api/enrollments/import-template,
 * разбор — server-action; валидные строки попадают в таблицу, невалидные —
 * списком «Строка N: …»). Доп. поля (должность, СНИЛС, дата рождения,
 * «Дополнительно») — необязательные и редактируемые у любой позиции
 * (решения заказчика §10 спеки).
 */

export type DirectionOption = { id: string; name: string };
export type WizardOrgOption = { id: string; name: string };
type StudentOption = { id: string; name: string; email: string };

type WizardRow = {
  key: string;
  /** id сотрудника организации; у добавленных вручную — null (ФИО/email редактируемы). */
  studentId: string | null;
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

/** Клиентская проверка позиций перед шагом 3 (сервер перепроверит всё заново). */
export function validateRowsClient(rows: WizardRow[]): string[] {
  const errors: string[] = [];
  if (rows.length === 0) errors.push('Добавьте хотя бы одного слушателя');
  rows.forEach((row, i) => {
    const label = row.fullName.trim() || `Слушатель ${i + 1}`;
    if (!row.studentId) {
      if (!row.fullName.trim()) errors.push(`Слушатель ${i + 1}: не указано ФИО`);
      if (!row.email.trim()) errors.push(`${label}: не указан email`);
      else if (!EMAIL_RE.test(row.email.trim())) errors.push(`${label}: некорректный email`);
    }
    const snilsDigits = row.snils.replace(/[\s-]/g, '');
    if (snilsDigits && !/^\d{11}$/.test(snilsDigits)) {
      errors.push(`${label}: СНИЛС должен содержать 11 цифр`);
    }
  });
  return errors;
}

export function EnrollmentWizard({
  directions,
  organizations,
  defaultOrganizationId
}: {
  directions: DirectionOption[];
  /** Партнёр/менеджер выбирают организацию; у роли организации — её активная. */
  organizations?: WizardOrgOption[];
  defaultOrganizationId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [directionId, setDirectionId] = useState('');
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId ?? '');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<WizardRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Сотрудники выбранной организации для чекбоксов шага 2. Загрузка выводится
  // из «для какой организации список уже загружен» — так в эффекте нет
  // синхронных setState (eslint react-hooks/set-state-in-effect).
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loadedForOrg, setLoadedForOrg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const studentsLoading = !!organizationId && loadedForOrg !== organizationId;

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void fetch(`/api/enrollments/students?organizationId=${encodeURIComponent(organizationId)}`)
      .then(async (res) => (res.ok ? ((await res.json()) as { students: StudentOption[] }).students : []))
      .catch(() => [] as StudentOption[])
      .then((list) => {
        if (cancelled) return;
        setStudents(list);
        setLoadedForOrg(organizationId);
        // Смена организации делает выбранных сотрудников невалидными — снимаем их.
        setRows((prev) => prev.filter((r) => !r.studentId || list.some((s) => s.id === r.studentId)));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [students, search]);

  const directionName = directions.find((d) => d.id === directionId)?.name ?? '';
  const orgName = organizations?.find((o) => o.id === organizationId)?.name ?? '';

  function toggleStudent(s: StudentOption, checked: boolean) {
    setRows((prev) => {
      if (checked) {
        // Причина ignore: чекбокс контролируемый (checked = «уже в rows»), поэтому
        // onChange(true) для уже добавленного сотрудника прийти не может. Guard
        // защищает от двойного события в одну отрисовку — оставлен сознательно.
        /* v8 ignore next */
        if (prev.some((r) => r.studentId === s.id)) return prev;
        return [
          ...prev,
          { key: nextKey(), studentId: s.id, fullName: s.name, email: s.email, position: '', snils: '', birthDate: '', extra: '' }
        ];
      }
      return prev.filter((r) => r.studentId !== s.id);
    });
  }

  function addManualRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey(), studentId: null, fullName: '', email: '', position: '', snils: '', birthDate: '', extra: '' }
    ]);
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
      const seen = new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean));
      const added: WizardRow[] = [];
      const warnings = [...res.warnings];
      for (const item of res.items) {
        if (seen.has(item.email)) {
          warnings.push(`${item.fullName} (${item.email}): уже в заявке — пропущен`);
          continue;
        }
        seen.add(item.email);
        added.push({
          key: nextKey(),
          studentId: null,
          fullName: item.fullName,
          email: item.email,
          position: item.position ?? '',
          snils: item.snils ?? '',
          birthDate: item.birthDate ? new Date(item.birthDate).toISOString().slice(0, 10) : '',
          extra: item.extra ?? ''
        });
      }
      if (added.length) {
        setRows((prev) => [...prev, ...added]);
        toast.success(`Импортировано слушателей: ${added.length}`);
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
          directionId,
          organizationId: organizationId || null,
          note: note.trim() || null,
          items: rows.map((r) => ({
            studentId: r.studentId,
            fullName: r.fullName,
            email: r.email,
            position: r.position,
            snils: r.snils,
            birthDate: r.birthDate,
            extra: r.extra
          }))
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; messages?: string[] };
        if (body.messages?.length) setErrors(body.messages);
        else toast.error(`Не удалось отправить заявку: ${body.error ?? res.status}`);
        return;
      }
      const body = (await res.json()) as { itemCount: number; warnings?: string[] };
      toast.success(`Заявка на обучение отправлена (слушателей: ${body.itemCount})`);
      for (const w of body.warnings ?? []) toast.info(w);
      setStep(1);
      setDirectionId('');
      setNote('');
      setRows([]);
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  const stepTitle = step === 1 ? 'Направление' : step === 2 ? 'Слушатели' : 'Проверка';

  return (
    <section className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <div>
        <h2 className='font-semibold text-[#111111]'>Подать заявку на обучение</h2>
        <p className='text-xs text-gray-500 mt-0.5'>
          Шаг {step} из 3 — {stepTitle}. Одной заявкой можно отправить сразу всех слушателей.
        </p>
      </div>

      {step === 1 && (
        <div className='space-y-3'>
          <label className='block'>
            <span className='block text-sm font-medium text-gray-700 mb-1'>Направление обучения</span>
            <select value={directionId} onChange={(e) => setDirectionId(e.target.value)} className={inputCls}>
              <option value=''>— выберите направление —</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {directions.length === 0 && (
            <div className='text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2'>
              Справочник направлений пуст — обратитесь к менеджеру, чтобы направления добавили.
            </div>
          )}
          {organizations && organizations.length > 0 && (
            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Организация</span>
              <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className={inputCls}>
                <option value=''>— без организации —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className='flex justify-end'>
            <Button onClick={() => setStep(2)} disabled={!directionId}>
              Далее: слушатели
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className='space-y-4'>
          {organizationId ? (
            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-sm font-medium text-gray-700'>Из сотрудников организации</span>
                <input
                  type='search'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder='Поиск по ФИО или email'
                  className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F97316]'
                />
              </div>
              {studentsLoading ? (
                <div className='text-sm text-gray-500'>Загружаем сотрудников…</div>
              ) : students.length === 0 ? (
                <div className='text-sm text-gray-500'>
                  У организации пока нет сотрудников в системе — добавьте слушателей строками ниже.
                </div>
              ) : (
                <ul className='max-h-56 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50'>
                  {visibleStudents.map((s) => {
                    const checked = rows.some((r) => r.studentId === s.id);
                    return (
                      <li key={s.id}>
                        <label className='flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50'>
                          <input
                            type='checkbox'
                            checked={checked}
                            onChange={(e) => toggleStudent(s, e.target.checked)}
                            className='accent-[#F97316]'
                          />
                          <span className='text-sm text-[#111111]'>{s.name}</span>
                          <span className='text-xs text-gray-500'>{s.email}</span>
                        </label>
                      </li>
                    );
                  })}
                  {visibleStudents.length === 0 && (
                    <li className='px-3 py-2 text-sm text-gray-500'>Никого не нашли по запросу.</li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <div className='text-xs text-gray-500'>
              Организация не выбрана — добавьте слушателей строками ниже.
            </div>
          )}

          <div className='space-y-2 border border-gray-100 rounded-lg p-3'>
            <div className='flex flex-wrap items-center gap-3'>
              <span className='text-sm font-medium text-gray-700'>Импорт из Excel</span>
              <a
                href='/api/enrollments/import-template'
                download
                className='text-sm text-[#F97316] hover:underline'
              >
                Скачать шаблон
              </a>
              <label className='text-sm text-[#F97316] hover:underline cursor-pointer'>
                {importBusy ? 'Обрабатываем файл…' : 'Загрузить файл'}
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.xlsx'
                  className='sr-only'
                  disabled={importBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </label>
            </div>
            <p className='text-xs text-gray-500'>
              Заполните шаблон (обязательны ФИО и Email) и загрузите файл — слушатели добавятся в заявку.
            </p>
            {importErrors.length > 0 && (
              <ul className='text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5' role='alert'>
                {importErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {importWarnings.length > 0 && (
              <ul className='text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-0.5' role='status'>
                {importWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium text-gray-700'>Слушатели в заявке: {rows.length}</span>
              <Button size='sm' variant='secondary' onClick={addManualRow}>
                + Добавить слушателя
              </Button>
            </div>
            {rows.length === 0 && (
              <div className='text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center'>
                Отметьте сотрудников галочками или добавьте новых слушателей строками —
                достаточно ФИО и email, остальные поля по желанию.
              </div>
            )}
            {rows.map((row, i) => (
              <div key={row.key} className='border border-gray-100 rounded-lg p-3 space-y-2'>
                <div className='flex items-center justify-between'>
                  <span className='text-xs font-medium text-gray-500'>
                    Слушатель {i + 1}
                    {row.studentId && <span className='ml-2 text-emerald-700'>из сотрудников</span>}
                  </span>
                  <button
                    type='button'
                    onClick={() => removeRow(row.key)}
                    className='text-xs text-red-600 hover:underline'
                  >
                    Удалить
                  </button>
                </div>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  <input
                    type='text'
                    value={row.fullName}
                    onChange={(e) => updateRow(row.key, { fullName: e.target.value })}
                    placeholder='ФИО *'
                    disabled={!!row.studentId}
                    className={`${smallInputCls} disabled:bg-gray-50 disabled:text-gray-500`}
                  />
                  <input
                    type='email'
                    value={row.email}
                    onChange={(e) => updateRow(row.key, { email: e.target.value })}
                    placeholder='Email *'
                    disabled={!!row.studentId}
                    className={`${smallInputCls} disabled:bg-gray-50 disabled:text-gray-500`}
                  />
                  <input
                    type='text'
                    value={row.position}
                    onChange={(e) => updateRow(row.key, { position: e.target.value })}
                    placeholder='Должность'
                    className={smallInputCls}
                  />
                  <input
                    type='text'
                    value={row.snils}
                    onChange={(e) => updateRow(row.key, { snils: e.target.value })}
                    placeholder='СНИЛС (11 цифр)'
                    className={smallInputCls}
                  />
                  <label className='block'>
                    <span className='block text-[11px] text-gray-500 mb-0.5'>Дата рождения</span>
                    <input
                      type='date'
                      value={row.birthDate}
                      onChange={(e) => updateRow(row.key, { birthDate: e.target.value })}
                      className={smallInputCls}
                    />
                  </label>
                  <label className='block'>
                    <span className='block text-[11px] text-gray-500 mb-0.5'>Дополнительно</span>
                    <input
                      type='text'
                      value={row.extra}
                      onChange={(e) => updateRow(row.key, { extra: e.target.value })}
                      placeholder='Любая дополнительная информация'
                      className={smallInputCls}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          {errors.length > 0 && (
            <ul className='text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5' role='alert'>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className='flex justify-between'>
            <Button variant='secondary' onClick={() => setStep(1)}>
              Назад
            </Button>
            <Button onClick={goToStep3} disabled={rows.length === 0}>
              Далее: проверка
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className='space-y-3'>
          <div className='text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1'>
            <div>
              Направление: <span className='font-medium text-[#111111]'>{directionName}</span>
            </div>
            {orgName && (
              <div>
                Организация: <span className='font-medium text-[#111111]'>{orgName}</span>
              </div>
            )}
            <div>
              Слушателей: <span className='font-medium text-[#111111]'>{rows.length}</span>
            </div>
          </div>
          <ul className='text-sm text-gray-700 border border-gray-100 rounded-lg divide-y divide-gray-50'>
            {rows.map((r, i) => (
              <li key={r.key} className='px-3 py-2'>
                {/* Без запасного «—»: валидация шага 2 не пускает на итог позицию
                    без ФИО, поэтому fallback был недостижим (Ф4 программы покрытия). */}
                <span className='font-medium text-[#111111]'>{i + 1}. {r.fullName}</span>{' '}
                <span className='text-xs text-gray-500'>{r.email}</span>
                {r.position && <span className='text-xs text-gray-500'> · {r.position}</span>}
              </li>
            ))}
          </ul>
          <label className='block'>
            <span className='block text-sm font-medium text-gray-700 mb-1'>Примечание к заявке (необязательно)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} />
          </label>

          {errors.length > 0 && (
            <ul className='text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5' role='alert'>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className='flex justify-between'>
            <Button variant='secondary' onClick={() => setStep(2)} disabled={busy}>
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
