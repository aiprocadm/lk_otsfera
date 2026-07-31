// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * Guard-тесты встраивания антидублей (этап 5 PR-2, ФТ-13.4): плашка
 * InnDuplicateHint — ТОЛЬКО в staff-формах.
 *  - Клиентская форма обращения (client-request-form) НЕ содержит плашку:
 *    ввод валидного ИНН не порождает ни одного запроса к /api/duplicates
 *    (клиентам факт существования ИНН в базе не раскрывается);
 *  - staff-формы lead-create-staff-form и create-organization-dialog
 *    СОДЕРЖАТ плашку: ввод валидного ИНН зовёт /api/duplicates/by-inn
 *    и рендерит «Уже есть в базе:».
 * Поведенческий guard (fetch-шпион по URL после advanceTimers), а не
 * снапшот импортов: ловит и «протащили компонент», и «зовут роут напрямую».
 */

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock('@/server-actions/manager/create-lead', () => ({ createLeadByStaffAction: vi.fn() }));
vi.mock('@/server-actions/admin/organizations', () => ({ createOrganizationAction: vi.fn() }));

import { ClientRequestForm } from '@/components/client-requests/client-request-form';
import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';
import { CreateOrganizationDialog } from '@/components/admin/create-organization-dialog';

const VALID_INN = '7707083893';
const DUPLICATES_RESPONSE = {
  ok: true,
  json: async () => ({
    duplicates: { organizations: [{ id: 'o1', name: 'ООО Ромашка' }], leads: [] },
  }),
};

let fetchMock: ReturnType<typeof vi.fn>;

function duplicatesCalls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((url) => url.includes('/api/duplicates'));
}

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(DUPLICATES_RESPONSE);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ФТ-13.4 guard: клиентская форма обращения БЕЗ антидублей', () => {
  it('ввод валидного ИНН не зовёт /api/duplicates и не рендерит плашку', async () => {
    const { container } = render(<ClientRequestForm />);
    const innInput = container.querySelector('#cr-inn') as HTMLInputElement;
    expect(innInput).toBeTruthy();

    fireEvent.change(innInput, { target: { value: VALID_INN } });
    await settle(1000); // с запасом больше debounce плашки (400мс)

    expect(duplicatesCalls()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled(); // вообще никакой фоновой активности
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('и ИНН с пробелами/дефисами тоже не порождает запросов', async () => {
    const { container } = render(<ClientRequestForm />);
    fireEvent.change(container.querySelector('#cr-inn') as HTMLInputElement, {
      target: { value: '7707 083-893' },
    });
    await settle(1000);
    expect(duplicatesCalls()).toEqual([]);
  });
});

describe('ФТ-13.4 guard: staff-формы С антидублями', () => {
  it('lead-create-staff-form: ввод валидного ИНН зовёт /api/duplicates/by-inn и показывает плашку', async () => {
    const { container } = render(<LeadCreateStaffForm organizations={[]} />);
    const innInput = container.querySelector('#lcs-inn') as HTMLInputElement;
    expect(innInput).toBeTruthy();

    fireEvent.change(innInput, { target: { value: VALID_INN } });
    await settle(400);

    expect(duplicatesCalls()).toEqual([`/api/duplicates/by-inn?inn=${VALID_INN}`]);
    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();
    // Плашка менеджерская: ссылки ведут в /manager/organizations. Форма живёт
    // в закрытом <dialog> (children рендерятся всегда), role-запросы считают
    // его содержимое скрытым → ищем ссылку по тексту.
    expect(screen.getByText('ООО Ромашка').closest('a')?.getAttribute('href')).toBe(
      '/manager/organizations/o1'
    );
  });

  it('create-organization-dialog: ввод валидного ИНН зовёт /api/duplicates/by-inn и показывает плашку', async () => {
    const { container } = render(<CreateOrganizationDialog />);
    const innInput = container.querySelector('input[name="inn"]') as HTMLInputElement;
    expect(innInput).toBeTruthy();

    fireEvent.change(innInput, { target: { value: VALID_INN } });
    await settle(400);

    expect(duplicatesCalls()).toEqual([`/api/duplicates/by-inn?inn=${VALID_INN}`]);
    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();
    // Плашка админская: ссылки ведут в /admin/organizations (dialog закрыт →
    // ищем по тексту, см. комментарий в тесте выше).
    expect(screen.getByText('ООО Ромашка').closest('a')?.getAttribute('href')).toBe(
      '/admin/organizations/o1'
    );
  });
});
