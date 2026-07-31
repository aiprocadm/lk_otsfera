/**
 * Этап 7 (ФТ-8.2) — server-actions Intake: диспетчер claim по типу,
 * маппинг lifecycle→already_assigned для ClientRequest, конверт-инпут.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  claimEnrollment,
  claimInbound,
  claimCall,
  closeCallIntake,
  createLeadFromInbound,
  createLeadFromCall,
  takeInTriage,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  claimEnrollment: vi.fn(),
  claimInbound: vi.fn(),
  claimCall: vi.fn(),
  closeCallIntake: vi.fn(),
  createLeadFromInbound: vi.fn(),
  createLeadFromCall: vi.fn(),
  takeInTriage: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/intake/claim', () => ({
  claimEnrollment,
  claimInbound,
  claimCall,
  closeCallIntake,
}));
vi.mock('@/lib/services/intake/convert', () => ({ createLeadFromInbound, createLeadFromCall }));
vi.mock('@/lib/services/clientRequests/triage', () => ({ takeInTriage }));

import {
  claimIntakeAction,
  closeCallIntakeAction,
  createLeadFromInboundAction,
  createLeadFromCallAction,
} from '@/server-actions/intake';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'c1' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('claimIntakeAction', () => {
  it('диспетчит по типу к нужному сервису и ревалидирует', async () => {
    claimEnrollment.mockResolvedValue({ ok: true, changed: true });
    expect(await claimIntakeAction(form({ type: 'enrollment', id: 'e1' }))).toEqual({ ok: true });
    expect(claimEnrollment).toHaveBeenCalledWith({}, SESSION, { id: 'e1' });

    claimInbound.mockResolvedValue({ ok: true, changed: true });
    await claimIntakeAction(form({ type: 'inbound', id: 'i1' }));
    expect(claimInbound).toHaveBeenCalledWith({}, SESSION, { id: 'i1' });

    claimCall.mockResolvedValue({ ok: true, changed: true });
    await claimIntakeAction(form({ type: 'call', id: 'c1' }));
    expect(claimCall).toHaveBeenCalledWith({}, SESSION, { id: 'c1' });

    expect(revalidatePath).toHaveBeenCalledWith('/manager/intake');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/intake');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/intake');
  });

  it('client_request → takeInTriage; lifecycle_violation мапится в already_assigned', async () => {
    takeInTriage.mockResolvedValue({ ok: true, request: {} });
    expect(await claimIntakeAction(form({ type: 'client_request', id: 'r1' }))).toEqual({
      ok: true,
    });
    expect(takeInTriage).toHaveBeenCalledWith({}, SESSION, { id: 'r1' });

    takeInTriage.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    expect(await claimIntakeAction(form({ type: 'client_request', id: 'r1' }))).toEqual({
      ok: false,
      error: 'already_assigned',
    });

    takeInTriage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await claimIntakeAction(form({ type: 'client_request', id: 'r1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('неизвестный тип / пустой id → validation; ошибка сервиса не ревалидирует', async () => {
    expect(await claimIntakeAction(form({ type: 'bogus', id: 'x' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await claimIntakeAction(form({ type: 'call' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    claimCall.mockResolvedValue({ ok: false, error: 'already_assigned' });
    expect(await claimIntakeAction(form({ type: 'call', id: 'c1' }))).toEqual({
      ok: false,
      error: 'already_assigned',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('closeCallIntakeAction', () => {
  it('успех + revalidate; пустой id → validation', async () => {
    closeCallIntake.mockResolvedValue({ ok: true, changed: true });
    expect(await closeCallIntakeAction(form({ id: 'c1' }))).toEqual({ ok: true });
    expect(closeCallIntake).toHaveBeenCalledWith({}, SESSION, { id: 'c1' });
    expect(await closeCallIntakeAction(new FormData())).toEqual({ ok: false, error: 'validation' });
  });
  it('отказ сервиса при закрытии звонка не ревалидирует экран', async () => {
    closeCallIntake.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await closeCallIntakeAction(form({ id: 'c1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createLeadFrom*Action', () => {
  const FIELDS = { sourceId: 'i1', companyName: 'ООО', contactName: 'Иван', subject: 'Тема' };

  it('inbound: собирает input, отдаёт leadId, ревалидирует inbox', async () => {
    createLeadFromInbound.mockResolvedValue({ ok: true, lead: { id: 'lead-1' } });
    const res = await createLeadFromInboundAction(form(FIELDS));
    expect(res).toEqual({ ok: true, leadId: 'lead-1' });
    expect(createLeadFromInbound).toHaveBeenCalledWith({}, SESSION, {
      inboundId: 'i1',
      input: expect.objectContaining({
        companyName: 'ООО',
        contactName: 'Иван',
        subject: 'Тема',
        inn: null,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/inbox');
  });

  it('inbound: пустой sourceId → validation; отказ сервиса без messages пробрасывается', async () => {
    // Симметрия с call-вариантом: у обеих кнопок один и тот же контракт, и
    // ошибка без пояснений не должна превращаться в успех.
    expect(await createLeadFromInboundAction(form({ companyName: 'x' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    createLeadFromInbound.mockResolvedValue({ ok: false, error: 'already_converted' });
    expect(await createLeadFromInboundAction(form(FIELDS))).toEqual({
      ok: false,
      error: 'already_converted',
      messages: undefined,
    });
  });

  it('call: маппинг ошибок с messages; пустой sourceId → validation', async () => {
    createLeadFromCall.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Укажите тему'],
    });
    expect(await createLeadFromCallAction(form({ ...FIELDS, sourceId: 'c1' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите тему'],
    });
    expect(await createLeadFromCallAction(form({ companyName: 'x' }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('незаполненные поля формы уходят как null, а не пустые строки', async () => {
    // Форму конвертации заполняют частично: пустое поле означает «не знаю», и в
    // лиде должен оказаться null. Пустая строка выглядела бы как заполненное
    // поле и мешала бы потом искать лиды без контакта.
    createLeadFromInbound.mockResolvedValue({ ok: true, lead: { id: 'lead-3' } });
    await createLeadFromInboundAction(
      form({
        sourceId: 'i1',
        companyName: '',
        inn: '',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        subject: '',
        notes: '',
      })
    );
    expect(createLeadFromInbound).toHaveBeenCalledWith({}, SESSION, {
      inboundId: 'i1',
      input: {
        companyName: null,
        inn: null,
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        subject: null,
        notes: null,
      },
    });
  });

  it('call: успех ревалидирует журнал звонков', async () => {
    createLeadFromCall.mockResolvedValue({ ok: true, lead: { id: 'lead-2' } });
    expect(await createLeadFromCallAction(form({ ...FIELDS, sourceId: 'c1' }))).toEqual({
      ok: true,
      leadId: 'lead-2',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/calls');
  });
});
