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
const POLL_MS = 3000;

/**
 * Рабочие состояния пакета и заголовок под каждое: человек нажал «Применить»
 * и должен читать про перенос, а не про предпросмотр. Список один — из него же
 * выводится «идёт ли работа», иначе состояние и подпись однажды разойдутся.
 */
const BUSY_TITLES = {
  preview_pending: 'Считаем предпросмотр…',
  applying: 'Переносим данные…',
  rolling_back: 'Откатываем пакет…',
} as const;

type BusyStatus = keyof typeof BUSY_TITLES;

const isBusy = (status: string): status is BusyStatus => status in BUSY_TITLES;

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
  const busy = isBusy(status);

  useEffect(() => {
    if (!busy) return;
    let stopped = false;

    async function poll(): Promise<void> {
      // Эффект живёт только в браузере, поэтому `document` здесь есть всегда.
      if (document.visibilityState !== 'visible') return;
      const res = await getBitrixBatchStateAction(batchId);
      // Ответ мог прийти после ухода со страницы — тогда обновлять уже нечего.
      if (stopped || !res.ok) return;
      if (res.progress) setState({ step: res.progress.step, done: res.progress.done });
      if (!isBusy(res.status)) {
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

  if (!isBusy(status)) return null;

  return (
    <div role="status" className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
      <div className="text-sm font-medium text-[#111111]">{BUSY_TITLES[status]}</div>
      <p className="text-sm text-gray-600">
        {state
          ? `Обработано записей: ${state.done}. Сейчас — ${STEP_LABELS[state.step] ?? state.step}.`
          : 'Задача поставлена в очередь. Страница обновится сама, когда всё посчитается.'}
      </p>
    </div>
  );
}
