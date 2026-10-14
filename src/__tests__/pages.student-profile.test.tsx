// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Мой профиль» слушателя (`У-284`, этап 2 ТЗ 13.10.2026): ФИО, организация,
 * обучения со сроками, удостоверения с тем, когда они истекают. Чужим ролям —
 * 404 (гард — сервис кабинета).
 */
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
const { getStudentCabinet } = vi.hoisted(() => ({ getStudentCabinet: vi.fn() }));
vi.mock('@/lib/services/students/cabinet', () => ({ getStudentCabinet }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/components/dashboard/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'app-shell' }, children),
}));

import StudentProfilePage from '@/app/student/profile/page';

const cabinet = (over: Record<string, unknown> = {}) => ({
  ok: true,
  cabinet: {
    name: 'Анна Слушатель',
    organizations: ['ООО Ромашка', 'АО Василёк'],
    trainings: [
      {
        id: 't1',
        directionName: 'Охрана труда',
        organizationName: 'ООО Ромашка',
        status: 'approved',
        statusLabel: 'Обучение назначено',
        startsOn: '2026-11-01',
        endsOn: '2026-11-15',
      },
    ],
    certificates: [
      {
        id: 'c1',
        directionName: 'Охрана труда',
        number: 'ОТ-1',
        issuedAt: '2026-11-16T09:00:00.000Z',
        validUntil: '2029-11-16',
        daysLeft: 1096,
      },
    ],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'student' });
});

describe('StudentProfilePage', () => {
  it('показывает ФИО, организации, обучения со сроками и удостоверения', async () => {
    getStudentCabinet.mockResolvedValue(cabinet());
    const { container } = await renderServerComponent(StudentProfilePage());
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Мой профиль');
    expect(text).toContain('Анна Слушатель');
    expect(text).toContain('ООО Ромашка, АО Василёк');
    expect(text).toContain('Обучение назначено · с 01.11.2026 по 15.11.2026');
    expect(text).toContain('Охрана труда · № ОТ-1');
    expect(text).toContain('Действует до 16.11.2029 — осталось 1096 дней');
    expect(text).not.toContain('пока не указана');
  });

  it('учётка ещё не связана с организацией — объяснение, что делать', async () => {
    getStudentCabinet.mockResolvedValue(
      cabinet({ name: '', organizations: [], trainings: [], certificates: [] })
    );
    const { container } = await renderServerComponent(StudentProfilePage());
    const text = container.textContent ?? '';
    expect(text).toContain('пока не указана');
    expect(text).toContain('с тем же e-mail');
    expect(text).toContain('Обучений пока нет');
    expect(text).toContain('Удостоверений пока нет');
    expect(container.querySelector('a[href="/student"]')).toBeTruthy();
  });

  it('не слушатель — 404', async () => {
    requireSession.mockResolvedValue({ sub: 'm', role: 'manager' });
    getStudentCabinet.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(StudentProfilePage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
