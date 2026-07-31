/**
 * M5 — unit-тесты server-actions календаря (спека 2026-07-17-m5-calendar §4).
 * Hoisted-мок сервиса + requireSession + next/cache; флаг staff_calendar (opt-in)
 * включается через env в beforeEach — isFeatureEnabled читает process.env на
 * каждый вызов (см. featureFlags.test.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, revalidatePath, createEvent, updateEvent, deleteEvent } = vi.hoisted(
  () => ({
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  })
);

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/calendar/events', () => ({
  createEvent,
  updateEvent,
  deleteEvent,
  REMIND_MINUTES: [15, 60, 1440],
}));

import { createEventAction, updateEventAction, deleteEventAction } from '@/server-actions/calendar';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'c1' };
const FLAG_ENV = 'FEATURE_STAFF_CALENDAR';
const savedFlag = process.env[FLAG_ENV];

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  process.env[FLAG_ENV] = '1';
});

afterAll(() => {
  if (savedFlag === undefined) delete process.env[FLAG_ENV];
  else process.env[FLAG_ENV] = savedFlag;
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function validForm(extra: Record<string, string> = {}): FormData {
  return form({ title: 'Встреча', startsAt: '2026-07-20T10:00', ...extra });
}

describe('флаг staff_calendar off', () => {
  it.each([
    ['create', () => createEventAction(validForm()), createEvent],
    ['update', () => updateEventAction(validForm({ id: 'e1' })), updateEvent],
    ['delete', () => deleteEventAction(form({ id: 'e1' })), deleteEvent],
  ] as const)('%s → forbidden, сервис не вызван', async (_name, run, serviceMock) => {
    delete process.env[FLAG_ENV]; // opt-in: без env флаг выключен
    expect(await run()).toEqual({ ok: false, error: 'forbidden' });
    expect(serviceMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createEventAction', () => {
  it('happy path: маппинг FormData → input, revalidate обеих страниц, id наружу', async () => {
    createEvent.mockResolvedValue({ ok: true, id: 'e9' });
    const fd = validForm({
      description: 'Повестка',
      location: 'Zoom',
      endsAt: '2026-07-20T11:00',
      allDay: 'on',
      remindMinutes: '15',
      linkedOrderId: 'o1',
      linkedOrganizationId: 'org1',
    });
    fd.append('attendeeIds', 'u2');
    fd.append('attendeeIds', 'u3');
    const res = await createEventAction(fd);
    expect(res).toEqual({ ok: true, id: 'e9' });
    expect(createEvent).toHaveBeenCalledWith({}, SESSION, {
      title: 'Встреча',
      description: 'Повестка',
      location: 'Zoom',
      startsAt: new Date('2026-07-20T10:00'),
      endsAt: new Date('2026-07-20T11:00'),
      allDay: true,
      remindMinutes: 15,
      linkedOrderId: 'o1',
      linkedOrganizationId: 'org1',
      attendeeIds: ['u2', 'u3'],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/calendar');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/calendar');
  });

  it('пустые опциональные поля → null/false/[], remindMinutes-мусор → null', async () => {
    createEvent.mockResolvedValue({ ok: true, id: 'e1' });
    await createEventAction(validForm({ remindMinutes: 'мусор' }));
    expect(createEvent).toHaveBeenCalledWith({}, SESSION, {
      title: 'Встреча',
      description: null,
      location: null,
      startsAt: new Date('2026-07-20T10:00'),
      endsAt: null,
      allDay: false,
      remindMinutes: null,
      linkedOrderId: null,
      linkedOrganizationId: null,
      attendeeIds: [],
    });
  });

  it("remindMinutes вне REMIND_MINUTES ('30') → null; allDay 'true' → true", async () => {
    createEvent.mockResolvedValue({ ok: true, id: 'e1' });
    await createEventAction(validForm({ remindMinutes: '30', allDay: 'true' }));
    expect(createEvent).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ remindMinutes: null, allDay: true })
    );
  });

  it('ошибка сервиса пробрасывается, revalidate не зовётся', async () => {
    createEvent.mockResolvedValue({ ok: false, error: 'validation' });
    expect(await createEventAction(validForm())).toEqual({ ok: false, error: 'validation' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateEventAction', () => {
  it('нет id → validation, сервис не вызван', async () => {
    expect(await updateEventAction(validForm())).toEqual({ ok: false, error: 'validation' });
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('happy path: сервис получает id + input, revalidate обеих страниц', async () => {
    updateEvent.mockResolvedValue({ ok: true });
    const res = await updateEventAction(validForm({ id: 'e5', remindMinutes: '1440' }));
    expect(res).toEqual({ ok: true });
    expect(updateEvent).toHaveBeenCalledWith(
      {},
      SESSION,
      'e5',
      expect.objectContaining({ title: 'Встреча', remindMinutes: 1440 })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/calendar');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/calendar');
  });

  it('ошибка сервиса (not_found) пробрасывается без revalidate', async () => {
    updateEvent.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await updateEventAction(validForm({ id: 'ghost' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('deleteEventAction', () => {
  it('нет id → not_found, сервис не вызван', async () => {
    expect(await deleteEventAction(new FormData())).toEqual({ ok: false, error: 'not_found' });
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('happy path: сервис + revalidate', async () => {
    deleteEvent.mockResolvedValue({ ok: true });
    expect(await deleteEventAction(form({ id: 'e7' }))).toEqual({ ok: true });
    expect(deleteEvent).toHaveBeenCalledWith({}, SESSION, 'e7');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/calendar');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/calendar');
  });

  it('ошибка сервиса пробрасывается без revalidate', async () => {
    deleteEvent.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await deleteEventAction(form({ id: 'e7' }))).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
