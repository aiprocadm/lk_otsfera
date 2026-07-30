import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createNotification, deliverNotificationToUser, resolveOrgManagerRecipients, warn } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  resolveOrgManagerRecipients: vi.fn(),
  warn: vi.fn()
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser, resolveOrgManagerRecipients }));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import {
  notifySubmitterEnrollmentStatus,
  notifyManagersEnrollmentSubmitted,
  submitterEnrollmentUrl
} from '@/lib/services/enrollments/notify';
import { enrollmentStatusLabel, ENROLLMENT_STATUS_LABEL } from '@/lib/services/enrollments/labels';

function db(summaryOver: Record<string, unknown> = {}) {
  const findUnique = vi.fn().mockResolvedValue({
    direction: { name: 'Охрана труда' },
    legacyCourseTitle: null,
    organization: { name: 'Ромашка' },
    _count: { items: 5 },
    ...summaryOver
  });
  return { d: { enrollmentRequest: { findUnique } } as never, findUnique };
}

const req = (over: Record<string, unknown> = {}) =>
  ({
    id: 'E1',
    status: 'approved',
    submitterRole: 'organization',
    submittedByUserId: 'u1',
    organizationId: 'o1',
    partnerId: null,
    rejectedReason: null,
    ...over
  }) as never;

beforeEach(() => {
  createNotification.mockReset().mockResolvedValue({ id: 'n1' });
  deliverNotificationToUser.mockReset().mockResolvedValue(undefined);
  resolveOrgManagerRecipients.mockReset().mockResolvedValue([]);
  warn.mockReset();
});

describe('русские подписи статусов (labels)', () => {
  it('enrollmentStatusLabel — единый источник подписей конвейера', () => {
    expect(enrollmentStatusLabel('pending' as never)).toBe('На рассмотрении');
    expect(enrollmentStatusLabel('certificates_ready' as never)).toBe('Удостоверения готовы');
    expect(ENROLLMENT_STATUS_LABEL.rejected).toBe('Отклонена');
  });
});

describe('submitterEnrollmentUrl (деталка только у organization/partner)', () => {
  it('роли ведут на свои разделы; неизвестная роль — без ссылки', () => {
    expect(submitterEnrollmentUrl('organization', 'E1')).toBe('/organization/enrollments/E1');
    expect(submitterEnrollmentUrl('partner', 'E1')).toBe('/partner/enrollments/E1');
    expect(submitterEnrollmentUrl('manager', 'E1')).toBe('/manager/enrollments');
    expect(submitterEnrollmentUrl('leader', 'E1')).toBe('/manager/enrollments');
    expect(submitterEnrollmentUrl('admin', 'E1')).toBe('/admin/enrollments');
    expect(submitterEnrollmentUrl('student', 'E1')).toBeNull();
  });
});

describe('notifySubmitterEnrollmentStatus (enrollment_status_changed подателю)', () => {
  it('organization: url в meta и в доставке; body — счётчик, направление, русская подпись статуса', async () => {
    const { d } = db();
    await notifySubmitterEnrollmentStatus(d, req());
    expect(createNotification).toHaveBeenCalledTimes(1);
    const created = createNotification.mock.calls[0][0];
    expect(created).toMatchObject({
      userId: 'u1',
      organizationId: 'o1',
      partnerId: null,
      type: 'enrollment_status_changed',
      meta: { requestId: 'E1', status: 'approved', url: '/organization/enrollments/E1' }
    });
    expect(created.title).toBe('Заявка на обучение — статус «Принята»');
    expect(created.body).toContain('5 слушателей');
    expect(created.body).toContain('направление «Охрана труда»');
    expect(created.body).toContain('статус «Принята»');
    expect(deliverNotificationToUser).toHaveBeenCalledWith({
      userId: 'u1',
      title: created.title,
      body: created.body,
      type: 'enrollment_status_changed',
      url: '/organization/enrollments/E1',
      dedupKey: 'n1'
    });
  });

  it('плюрализация: 1 слушатель / 2 слушателя', async () => {
    await notifySubmitterEnrollmentStatus(db({ _count: { items: 1 } }).d, req());
    expect(createNotification.mock.calls[0][0].body).toContain('1 слушатель,');
    await notifySubmitterEnrollmentStatus(db({ _count: { items: 2 } }).d, req());
    expect(createNotification.mock.calls[1][0].body).toContain('2 слушателя');
  });

  it('rejected с rejectedReason: причина дописана в body', async () => {
    const { d } = db();
    await notifySubmitterEnrollmentStatus(d, req({ status: 'rejected', rejectedReason: 'нет мест' }));
    const body = createNotification.mock.calls[0][0].body as string;
    expect(body).toContain('статус «Отклонена»');
    expect(body).toContain('Причина: нет мест');
  });

  it('заявка исчезла из БД → фолбэки «обучение» и «0 слушателей»', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await notifySubmitterEnrollmentStatus({ enrollmentRequest: { findUnique } } as never, req());
    const body = createNotification.mock.calls[0][0].body as string;
    expect(body).toContain('0 слушателей');
    expect(body).toContain('направление «обучение»');
  });

  it('legacy-заявка без direction: имя направления из legacyCourseTitle', async () => {
    const { d } = db({ direction: null, legacyCourseTitle: 'Старый курс' });
    await notifySubmitterEnrollmentStatus(d, req());
    expect(createNotification.mock.calls[0][0].body).toContain('направление «Старый курс»');
  });

  it('неизвестная роль подателя: без url и в meta, и в доставке', async () => {
    const { d } = db();
    await notifySubmitterEnrollmentStatus(d, req({ submitterRole: 'student' }));
    expect(createNotification.mock.calls[0][0].meta).toEqual({ requestId: 'E1', status: 'approved' });
    expect(deliverNotificationToUser.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('best-effort: сбой createNotification проглатывается с log.warn, доставки нет', async () => {
    createNotification.mockRejectedValue(new Error('db down'));
    const { d } = db();
    await expect(notifySubmitterEnrollmentStatus(d, req())).resolves.toBeUndefined();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] status notify failed', {
      requestId: 'E1',
      error: 'db down'
    });
  });

  it('best-effort: отказ не-Error значением логируется текстом, а не undefined', async () => {
    createNotification.mockRejectedValue('соединение закрыто');
    const { d } = db();
    await expect(notifySubmitterEnrollmentStatus(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] status notify failed', {
      requestId: 'E1',
      error: 'соединение закрыто'
    });
  });
});

describe('notifyManagersEnrollmentSubmitted (enrollment_submitted менеджерам организации)', () => {
  it('заявка без организации: fan-out пропускается целиком', async () => {
    const { d, findUnique } = db();
    await notifyManagersEnrollmentSubmitted(d, req({ organizationId: null }));
    expect(resolveOrgManagerRecipients).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('нет получателей → ничего не создаётся', async () => {
    const { d, findUnique } = db();
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(resolveOrgManagerRecipients).toHaveBeenCalledWith(d, 'o1', { excludeUserId: 'u1' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('2 получателя: по паре createNotification+доставка на каждого, dedupKey = id строки', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    createNotification.mockResolvedValueOnce({ id: 'n1' }).mockResolvedValueOnce({ id: 'n2' });
    const { d } = db();
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification.mock.calls[0][0]).toMatchObject({
      userId: 'm1',
      organizationId: 'o1',
      type: 'enrollment_submitted',
      title: 'Новая заявка на обучение',
      meta: { requestId: 'E1', url: '/manager/enrollments' }
    });
    expect(createNotification.mock.calls[0][0].body).toBe(
      'Организация «Ромашка»: 5 слушателей, направление «Охрана труда».'
    );
    expect(createNotification.mock.calls[1][0].userId).toBe('m2');
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser.mock.calls[0][0]).toMatchObject({
      userId: 'm1',
      type: 'enrollment_submitted',
      url: '/manager/enrollments',
      dedupKey: 'n1'
    });
    expect(deliverNotificationToUser.mock.calls[1][0]).toMatchObject({ userId: 'm2', dedupKey: 'n2' });
  });

  it('организация без имени: body без префикса «Организация …»', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }]);
    const { d } = db({ organization: null });
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(createNotification.mock.calls[0][0].body).toBe('5 слушателей, направление «Охрана труда».');
  });

  it('best-effort: сбой внутри проглатывается с log.warn', async () => {
    resolveOrgManagerRecipients.mockRejectedValue(new Error('boom'));
    const { d } = db();
    await expect(notifyManagersEnrollmentSubmitted(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] submit notify failed', {
      requestId: 'E1',
      error: 'boom'
    });
  });

  it('best-effort: отказ не-Error значением логируется текстом', async () => {
    resolveOrgManagerRecipients.mockRejectedValue('соединение закрыто');
    const { d } = db();
    await expect(notifyManagersEnrollmentSubmitted(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] submit notify failed', {
      requestId: 'E1',
      error: 'соединение закрыто'
    });
  });
});
