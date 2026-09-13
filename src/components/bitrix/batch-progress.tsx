'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBitrixBatchStateAction } from '@/server-actions/admin/bitrix';

/**
 * Полоса «пакет считается» (`У-193`, спека §3.2).
 *
 * Страница пакета серверная, а работа идёт в фоне, поэтому состояние
 * спрашивается по таймеру и только пока пакет действительно в работе. Когда
 * статус стал конечным, компонент обновляет страницу и замолкает — опрашивать
 * готовый пакет незачем. Вкладка в фоне не опрашивается вовсе: считать чужой
 * трафик за спиной пользователя невежливо (тот же приём, что у бейджей меню).
 */
const BUSY_STATUSES = new Set(['preview_pending', 'applying', 'rolling_back']);
const POLL_MS = 3000;

/** Заголовок под текущую работу: человек нажал «Применить» и должен видеть это. */
const BUSY_TITLES: Record<string, string> = {
  preview_pending: 'Считаем предпросмотр…',
  applying: 'Переносим данные…',
  rolling_back: 'Откатываем пакет…',
};

const STEP_LABELS: Record<string, string> = {
  users: 'сотрудники',
  stages: 'стадии',
  organization: 'организации',
  contact: 'контакты',
  lead: 'лиды',
  deal: 'сделки',
  note: 'заметки',
  task: 'задачи',
  file: 'файлы',
  order: 'заказы',
};

export function BatchProgress({ batchId, status }: { batchId: string; status: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ step: string; done: number } | null>(null);
  const busy = BUSY_STATUSES.has(status);

  useEffect(() => {
    if (!busy) return;
    let stopped = false;

    async function poll(): Promise<void> {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const res = await getBitrixBatchStateAction(batchId);
      if (stopped || !res.ok) return;
      if (res.progress) setState({ step: res.progress.step, done: res.progress.done });
      if (!BUSY_STATUSES.has(res.status)) {
        // Работа кончилась — глушим таймер, а не только игнорируем ответы:
        // иначе экран продолжал бы ходить на сервер каждые три секунды.
        stopped = true;
        clearInterval(timer);
        router.refresh();
      }
    }

    const timer = setInterval(() => void poll(), POLL_MS);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [batchId, busy, router]);

  if (!busy) return null;

  return (
    <div role="status" className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
      <div className="text-sm font-medium text-[#111111]">{BUSY_TITLES[status] ?? 'Работаем…'}</div>
      <p className="text-sm text-gray-600">
        {state
          ? `Обработано записей: ${state.done}. Сейчас — ${STEP_LABELS[state.step] ?? state.step}.`
          : 'Задача поставлена в очередь. Страница обновится сама, когда всё посчитается.'}
      </p>
    </div>
  );
}
