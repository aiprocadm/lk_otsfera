// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Phase-2 coverage — useFormAction stateful branches (success/error transitions,
 * onSuccess, refresh, reset via generation). The existing lib.useFormAction.test.tsx
 * only renders the idle state (renderToString) and covers resolveErrorText; the
 * useActionState action-callback + return-value branches need a live render harness
 * (jsdom + @testing-library renderHook/act).
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { useFormAction } from '@/lib/ui/useFormAction';

beforeEach(() => vi.clearAllMocks());

describe('useFormAction — stateful transitions', () => {
  it('idle initial state', () => {
    const { result } = renderHook(() =>
      useFormAction({ action: async () => ({ ok: true as const, id: 'x' }) })
    );
    expect(result.current.pending).toBe(false);
    expect(result.current.success).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.errorText).toBeNull();
  });

  it('success: sets data + success, calls onSuccess, and refresh when opted in', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useFormAction<{ inviteUrl: string }>({
        action: async () => ({ ok: true, inviteUrl: 'https://x/y' }),
        onSuccess,
        refresh: true
      })
    );
    await act(async () => {
      result.current.formAction(new FormData());
    });
    expect(result.current.success).toBe(true);
    expect(result.current.data).toEqual({ inviteUrl: 'https://x/y' });
    expect(onSuccess).toHaveBeenCalledWith({ inviteUrl: 'https://x/y' });
    expect(refresh).toHaveBeenCalledTimes(1); // refresh:true branch
  });

  it('error: maps the code via errorMap → errorText, no refresh', async () => {
    const { result } = renderHook(() =>
      useFormAction({
        action: async () => ({ ok: false as const, error: 'not_found' }),
        errorMap: { not_found: 'Не найдено.' }
      })
    );
    await act(async () => {
      result.current.formAction(new FormData());
    });
    expect(result.current.success).toBe(false);
    expect(result.current.errorText).toBe('Не найдено.');
    expect(result.current.data).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reset(): generation bump returns state to idle after a success', async () => {
    const { result } = renderHook(() =>
      useFormAction({ action: async () => ({ ok: true as const, id: '1' }) })
    );
    await act(async () => {
      result.current.formAction(new FormData());
    });
    expect(result.current.success).toBe(true);
    act(() => result.current.reset()); // generation !== state.generation → current becomes idle
    expect(result.current.success).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
