'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { InnDuplicates } from '@/lib/services/duplicates/findByInn';

/**
 * Информационная плашка антидублей по ИНН (этап 5 PR-2, ФТ-13.4) — ТОЛЬКО для
 * staff-форм (manager/admin): роут /api/duplicates/by-inn отдаёт клиентским
 * ролям 403, и клиентские формы этот компонент не подключают (факт
 * существования ИНН в базе клиентам не раскрывается). Плашка не блокирует
 * сабмит; 403/429/сбой сети → молча ничего не показываем.
 */

export type InnDuplicateHintProps = {
  inn: string;
  cardHrefBase: '/manager/organizations' | '/admin/organizations';
  /** Не показывать саму редактируемую организацию как «дубль» самой себя. */
  excludeOrganizationId?: string;
};

const DEBOUNCE_MS = 400;
const INN_RE = /^(\d{10}|\d{12})$/;

const LEAD_STATUS_RU: Record<string, string> = {
  new: 'Новый',
  in_review: 'На рассмотрении',
  qualified: 'Квалифицирован'
};

export function InnDuplicateHint({
  inn,
  cardHrefBase,
  excludeOrganizationId
}: InnDuplicateHintProps) {
  // Результат храним вместе с ИНН, для которого он получен: при смене ИНН
  // устаревшая плашка гаснет сама (без setState прямо в эффекте).
  const [result, setResult] = useState<{ inn: string; duplicates: InnDuplicates } | null>(null);
  // Отсекает поздние ответы после смены ИНН.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++requestSeqRef.current;
    const normalized = inn.replace(/[\s-]/g, '');
    if (!INN_RE.test(normalized)) return;

    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async-колбэк setTimeout: все ошибки пойманы try/catch внутри, возврат не используется
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/duplicates/by-inn?inn=${encodeURIComponent(normalized)}`);
        if (!res.ok) return; // 403/429/400 → молча ничего
        const body = (await res.json()) as { duplicates?: InnDuplicates };
        if (seq !== requestSeqRef.current) return;
        if (body.duplicates) setResult({ inn: normalized, duplicates: body.duplicates });
      } catch {
        // Сбой сети → молча ничего: плашка информационная, форму не трогаем.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inn]);

  const normalizedNow = inn.replace(/[\s-]/g, '');
  const duplicates = result && result.inn === normalizedNow ? result.duplicates : null;
  const organizations = (duplicates?.organizations ?? []).filter(
    (o) => o.id !== excludeOrganizationId
  );
  const leads = duplicates?.leads ?? [];
  if (organizations.length === 0 && leads.length === 0) return null;

  return (
    <div className='mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
      <div className='font-medium'>Уже есть в базе:</div>
      <ul className='mt-0.5 space-y-0.5'>
        {organizations.map((o) => (
          <li key={o.id}>
            <a
              href={`${cardHrefBase}/${o.id}`}
              className='underline'
              target='_blank'
              rel='noreferrer'
            >
              {o.name}
            </a>
          </li>
        ))}
        {leads.map((l) => (
          <li key={l.id}>
            Лид: {l.subject} ({LEAD_STATUS_RU[l.status] ?? l.status})
          </li>
        ))}
      </ul>
    </div>
  );
}
