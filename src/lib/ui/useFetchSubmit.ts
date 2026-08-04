'use client';

import { useMemo } from 'react';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

/**
 * Sibling-хук кластера 3 (fetch-формы) — тот же возвращаемый контракт §3, что и
 * useFormAction (spec §7.1: вариант «б»). Тонкий адаптер: строит
 * `action: (fd) => Promise<ActionResult<T>>` из fetch-дескриптора и делегирует
 * всю generation/pending/reset/refresh-логику в useFormAction. API-роуты не
 * трогаем — хук инкапсулирует только маппинг fetch → ActionResult
 * (response.ok / HTTP-статус / `{error}`-тело → код ошибки → resolveErrorText).
 */

type FetchMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type FetchSubmitDescriptor = {
  /** Абсолютный или относительный URL API-роута. */
  url: string;
  /** HTTP-метод; default 'POST'. */
  method?: FetchMethod | undefined;
  /**
   * Тело запроса из FormData формы.
   * - Вернёт FormData → отправляем как есть (multipart, без content-type — браузер
   *   проставит boundary сам). Это путь file-upload (кластер 4-стиль).
   * - Вернёт plain-object → JSON.stringify + `content-type: application/json`.
   * - Не задан → запрос без тела (например DELETE).
   */
  body?: ((formData: FormData) => FormData | object) | undefined;
};

type UseFetchSubmitOptions<T> = FetchSubmitDescriptor & {
  /** Переопределения поверх errorMessageRu(); формы переносят сюда свои ERROR_LABELS-дельты. */
  errorMap?: Record<string, string>;
  /** После ok:true — toast / onClose / копирование. */
  onSuccess?: (data: T) => void;
  /** router.refresh() после успеха (сохраняет поведение форм, которые рефрешат). */
  refresh?: boolean;
};

/**
 * Извлекает стабильный код ошибки из non-ok-ответа: сначала `{ error }`-тело
 * (Result-контракт роутов), иначе синтетический `http_<status>` — его подхватит
 * errorMap формы либо общий fallback «Ошибка: http_<status>».
 */
async function extractErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    /* тело не JSON / пустое */
  }
  return `http_${res.status}`;
}

/**
 * Чистый билдер fetch→ActionResult — без React, поэтому юнит-тестируется напрямую
 * в node-окружении (vitest без jsdom). Хук лишь оборачивает его в useMemo +
 * useFormAction.
 */
export function buildFetchAction<T>(
  desc: FetchSubmitDescriptor
): (formData: FormData) => Promise<ActionResult<T>> {
  const { url, method = 'POST', body } = desc;
  return async (formData: FormData): Promise<ActionResult<T>> => {
    let init: RequestInit = { method };
    if (body) {
      const payload = body(formData);
      if (payload instanceof FormData) {
        init = { method, body: payload };
      } else {
        init = {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        };
      }
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      return { ok: false, error: 'network' };
    }

    if (!res.ok && res.status !== 204) {
      return { ok: false, error: await extractErrorCode(res) };
    }

    // ok / 204 No Content: тело может быть пустым — успех без data-пейлоада.
    let data: T = {} as T;
    try {
      const json = (await res.json()) as T;
      if (json && typeof json === 'object') data = json;
    } catch {
      /* пустое тело — оставляем {} */
    }
    return { ok: true, ...data } as ActionResult<T>;
  };
}

export function useFetchSubmit<T = object>(opts: UseFetchSubmitOptions<T>) {
  const { url, method, body, errorMap, onSuccess, refresh } = opts;

  const action = useMemo(() => buildFetchAction<T>({ url, method, body }), [url, method, body]);

  return useFormAction<T>({ action, errorMap, onSuccess, refresh });
}
