'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { dismissWelcomeAction } from '@/server-actions/welcome';
import { toast } from '@/lib/ui/toast';

// Тип переехал в lib (правило lib-no-upward, фаза 3); реэкспорт сохраняет публичный API компонента.
export type { WelcomeAction } from '@/lib/welcomeActions';
import type { WelcomeAction } from '@/lib/welcomeActions';

/**
 * Одноразовый welcome-блок первого входа (этап 4, ФТ-10.4). Строго
 * презентационный и domain-agnostic (имя + готовый список карточек —
 * их состав собирают дашборды по флагам), поэтому сознательно общий для
 * organization/partner (§4 CLAUDE.md, исключение sibling-паттерна).
 * Скрывается кнопкой навсегда (решение §8-2 спеки этапа 4).
 */
export function WelcomeCard({ name, actions }: { name: string; actions: WelcomeAction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      await dismissWelcomeAction();
      router.refresh();
    } catch {
      toast.error('Не удалось скрыть блок — попробуйте ещё раз');
      setBusy(false);
    }
  }

  return (
    <section className="bg-[#FFF7ED] border border-orange-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[#111111]">
            Добро пожаловать{name ? `, ${name}` : ''}!
          </h2>
          <p className="text-sm text-gray-600 mt-0.5">С чего удобно начать работу в кабинете:</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="text-xs text-gray-500 hover:text-[#111111] hover:underline disabled:text-gray-300 whitespace-nowrap"
        >
          {busy ? 'Скрываем…' : 'Скрыть'}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mt-4">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="block bg-white border border-orange-100 rounded-lg p-3 hover:border-[#F97316] transition-colors"
          >
            <div className="text-sm font-medium text-[#111111]">{a.title}</div>
            <div className="text-xs text-gray-500 mt-0.5">{a.hint}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
