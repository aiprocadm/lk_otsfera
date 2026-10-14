// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

/**
 * Этап 2 ТЗ 13.10.2026 (`У-284`, `Р-2-3`): сотрудник задаёт сроки обучения в
 * строке слушателя; клиент сроки только видит. Проверяется то, что видит
 * человек: подпись сроков, кнопка «Сохранить сроки» неактивна без правок,
 * понятная ошибка вместо кода.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { EnrollmentItemDatesForm } from '@/components/enrollment/enrollment-item-dates-form';
import { EnrollmentDetailView } from '@/components/enrollment/enrollment-detail-view';
import type { EnrollmentDetail } from '@/lib/services/enrollments/detail';

const reply = (ok: boolean, body: unknown) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: async () => body }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnrollmentItemDatesForm', () => {
  it('без правок кнопка неактивна; сохранение шлёт даты и обновляет экран', async () => {
    const fetchMock = reply(true, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<EnrollmentItemDatesForm requestId="e1" itemId="i1" startsOn={null} endsOn={null} />);
    const save = screen.getByRole('button', { name: 'Сохранить сроки' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Начало обучения'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByLabelText('Окончание обучения'), {
      target: { value: '2026-11-15' },
    });
    expect((screen.getByLabelText('Окончание обучения') as HTMLInputElement).min).toBe(
      '2026-11-01'
    );
    fireEvent.click(save);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/enrollments/e1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'setItemDates',
        itemId: 'i1',
        startsOn: '2026-11-01',
        endsOn: '2026-11-15',
      }),
    });
    expect(toastMock.success).toHaveBeenCalledWith('Сроки обучения сохранены');
  });

  it('«окончание раньше начала» — объяснение словами', async () => {
    vi.stubGlobal('fetch', reply(false, { error: 'validation' }));
    render(
      <EnrollmentItemDatesForm requestId="e1" itemId="i1" startsOn="2026-11-01" endsOn={null} />
    );
    fireEvent.change(screen.getByLabelText('Окончание обучения'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сроки' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Окончание обучения не может быть раньше начала.'
    );
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('прочие отказы — русская строка; кривой ответ и обрыв связи — тоже', async () => {
    vi.stubGlobal('fetch', reply(false, { error: 'not_found' }));
    const { unmount } = render(
      <EnrollmentItemDatesForm requestId="e1" itemId="i1" startsOn={null} endsOn="2026-11-15" />
    );
    fireEvent.change(screen.getByLabelText('Окончание обучения'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сроки' }));
    expect((await screen.findByRole('alert')).textContent).not.toMatch(/not_found/);
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }))
    );
    const second = render(
      <EnrollmentItemDatesForm requestId="e1" itemId="i2" startsOn={null} endsOn={null} />
    );
    fireEvent.change(screen.getByLabelText('Начало обучения'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сроки' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    second.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    render(<EnrollmentItemDatesForm requestId="e1" itemId="i3" startsOn={null} endsOn={null} />);
    fireEvent.change(screen.getByLabelText('Начало обучения'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сроки' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Нет связи с сервером — попробуйте ещё раз.'
    );
  });
});

const item = (over: Partial<EnrollmentDetail['items'][number]>) => ({
  id: 'i1',
  studentId: null,
  fullName: 'Анна',
  email: 'a@x.test',
  position: null,
  snils: null,
  birthDate: null,
  extra: null,
  status: 'approved' as const,
  externalStudentId: null,
  directionName: 'Охрана труда',
  certificateDocumentId: null,
  startsOn: null,
  endsOn: null,
  ...over,
});

const detail = (items: EnrollmentDetail['items']): EnrollmentDetail => ({
  id: 'e1',
  directionName: 'Охрана труда',
  directionNames: ['Охрана труда'],
  status: 'approved',
  organizationName: null,
  partnerName: null,
  submittedByName: 'Податель',
  submitterRole: 'organization',
  note: null,
  rejectedReason: null,
  createdAt: new Date('2026-10-01T09:00:00Z'),
  reviewedAt: null,
  provisionedAt: null,
  items,
});

describe('EnrollmentDetailView — сроки обучения в строке слушателя', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it('клиент видит подпись сроков, но не форму', () => {
    const html = renderToString(
      <EnrollmentDetailView
        backHref="/organization/enrollments"
        detail={detail([
          item({ id: 'a', startsOn: d('2026-11-01'), endsOn: d('2026-11-15') }),
          item({ id: 'b', startsOn: d('2026-11-01') }),
          item({ id: 'c', endsOn: d('2026-11-15') }),
          item({ id: 'x' }),
        ])}
      />
    );
    expect(html).toContain('Обучение с 01.11.2026 по 15.11.2026');
    expect(html).toContain('Обучение с 01.11.2026<');
    expect(html).toContain('Обучение до 15.11.2026');
    expect(html).not.toContain('Сохранить сроки');
  });

  it('сотрудник видит форму у каждой не отклонённой позиции', () => {
    const html = renderToString(
      <EnrollmentDetailView
        backHref="/admin/enrollments"
        editDates
        detail={detail([
          item({ id: 'a', startsOn: d('2026-11-01'), endsOn: d('2026-11-15') }),
          item({ id: 'r', status: 'rejected' }),
        ])}
      />
    );
    expect(html.match(/Сохранить сроки/g)).toHaveLength(1);
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain('value="2026-11-15"');
  });
});
