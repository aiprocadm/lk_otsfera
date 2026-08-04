'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessageRu } from '@/lib/errors/messages';

/**
 * Единый submit-хук форм поверх React 19 useActionState
 * (spec: docs/superpowers/specs/2026-06-11-useactionstate-forms-design.md).
 * Типизирован Result-контрактом §3; ничего не рендерит — формы передают
 * pending/errorText в Dialog (busy/error) или inline-разметку сами.
 */

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Локализация кода ошибки: errorMap формы (специфичные коды) → общий словарь
 * errorMessageRu → fallback «Ошибка: <code>» (видимый код вместо немой ошибки —
 * паттерн существующих translateError форм).
 */
export function resolveErrorText(code: string, errorMap?: Record<string, string>): string {
  return errorMap?.[code] ?? errorMessageRu(code, `Ошибка: ${code}`);
}

type UseFormActionOptions<T> = {
  action: (formData: FormData) => Promise<ActionResult<T>>;
  /** Переопределения поверх errorMessageRu(); формы переносят сюда свои ERROR_LABELS-дельты. */
  errorMap?: Record<string, string> | undefined;
  /** После ok:true — toast / onClose / копирование. */
  onSuccess?: ((data: T) => void) | undefined;
  /** router.refresh() после успеха. Default false: Фаза 1 сохраняет поведение форм 1:1 (spec §6). */
  refresh?: boolean | undefined;
};

type FormActionState<T> =
  { status: 'idle' } | { status: 'success'; data: T } | { status: 'error'; errorText: string };

export function useFormAction<T = object>(opts: UseFormActionOptions<T>) {
  const router = useRouter();
  // reset() через generation-счётчик: useActionState не даёт сбросить state
  // извне, поэтому сравниваем поколение состояния с текущим.
  const [generation, setGeneration] = useState(0);

  const [state, formAction, pending] = useActionState<
    FormActionState<T> & { generation?: number },
    FormData
  >(
    async (_prev, formData) => {
      const result = await opts.action(formData);
      if (result.ok) {
        const { ok, ...data } = result;
        void ok; // отделяем success-payload от дискриминанта

        opts.onSuccess?.(data as T);
        if (opts.refresh) router.refresh();
        return { status: 'success', data: data as T, generation };
      }
      return {
        status: 'error',
        errorText: resolveErrorText(result.error, opts.errorMap),
        generation,
      };
    },
    { status: 'idle' }
  );

  const reset = useCallback(() => setGeneration((g) => g + 1), []);
  const current: FormActionState<T> =
    state.status !== 'idle' && state.generation !== generation ? { status: 'idle' } : state;

  // Во время pending feedback скрыт: до-хуковые формы чистили error/success
  // в начале сабмита (setError(null)) — сохраняем этот UX при ресабмите.
  return {
    /** В <form action={formAction}>. */
    formAction,
    pending,
    errorText: !pending && current.status === 'error' ? current.errorText : null,
    data: !pending && current.status === 'success' ? current.data : null,
    success: !pending && current.status === 'success',
    /** Сброс error/success (повторное открытие модалки, «создать ещё»). */
    reset,
  };
}
