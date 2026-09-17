import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordNotification, deliverNotificationToUser, resolveOrgManagerRecipients, warn } =
  vi.hoisted(() => ({
    recordNotification: vi.fn(),
    deliverNotificationToUser: vi.fn(),
    resolveOrgManagerRecipients: vi.fn(),
    warn: vi.fn(),
  }));
vi.mock('@/lib/notifications', () => ({
  recordNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients,
}));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import {
  notifySubmitterEnrollmentStatus,
  notifyManagersEnrollmentSubmitted,
  submitterEnrollmentUrl,
} from '@/lib/services/enrollments/notify';
import { enrollmentStatusLabel, ENROLLMENT_STATUS_LABEL } from '@/lib/services/enrollments/labels';

function db(summaryOver: Record<string, unknown> = {}) {
  // `У-36`: направление читается из ПОЗИЦИЙ заявки — шапочного поля больше нет.
  const findUnique = vi.fn().mockResolvedValue({
    items: [{ direction: { name: 'Охрана труда' } }],
    legacyCourseTitle: null,
    organization: { name: 'Ромашка' },
    _count: { items: 5 },
    ...summaryOver,
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
    ...over,
  }) as never;

beforeEach(() => {
  recordNotification.mockReset().mockResolvedValue({ row: { id: 'n1' }, deduped: false });
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
    expect(recordNotification).toHaveBeenCalledTimes(1);
    const created = recordNotification.mock.calls[0][1];
    // Тип для заказчика/партнёра: `url` остаётся и в meta, и в доставке —
    // кабинет подателя нотификатор считает сам; ключ дедупа — заявка.
    expect(created).toMatchObject({
      userId: 'u1',
      organizationId: 'o1',
      partnerId: null,
      type: 'enrollment_status_changed',
      meta: { requestId: 'E1', status: 'approved', url: '/organization/enrollments/E1' },
      entityId: 'E1',
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
      dedupKey: 'n1',
    });
  });

  it('повтор за час (deduped: true) — строка «×N», доставка не зовётся', async () => {
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    const { d } = db();
    await notifySubmitterEnrollmentStatus(d, req());
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('плюрализация: 1 слушатель / 2 слушателя', async () => {
    await notifySubmitterEnrollmentStatus(db({ _count: { items: 1 } }).d, req());
    expect(recordNotification.mock.calls[0][1].body).toContain('1 слушатель,');
    await notifySubmitterEnrollmentStatus(db({ _count: { items: 2 } }).d, req());
    expect(recordNotification.mock.calls[1][1].body).toContain('2 слушателя');
  });

  it('rejected с rejectedReason: причина дописана в body', async () => {
    const { d } = db();
    await notifySubmitterEnrollmentStatus(
      d,
      req({ status: 'rejected', rejectedReason: 'нет мест' })
    );
    const body = recordNotification.mock.calls[0][1].body as string;
    expect(body).toContain('статус «Отклонена»');
    expect(body).toContain('Причина: нет мест');
  });

  it('заявка исчезла из БД → фолбэки «обучение» и «0 слушателей»', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await notifySubmitterEnrollmentStatus({ enrollmentRequest: { findUnique } } as never, req());
    const body = recordNotification.mock.calls[0][1].body as string;
    expect(body).toContain('0 слушателей');
    expect(body).toContain('направление «обучение»');
  });

  it('У-44: направления берутся из позиций, повторы схлопываются, слово склоняется', async () => {
    const { d } = db({
      _count: { items: 3 },
      items: [
        { direction: { name: 'Работы на высоте' } },
        { direction: { name: 'Электробезопасность' } },
        { direction: { name: 'Работы на высоте' } },
      ],
    });
    await notifySubmitterEnrollmentStatus(d, req());
    const body = recordNotification.mock.calls[0][1].body as string;

    expect(body).toContain('направления «Работы на высоте, Электробезопасность»');
    // Шапочное «Охрана труда» больше не главный источник — оно лишь резерв.
    expect(body).not.toContain('Охрана труда');
  });

  it('У-44: одно направление на все позиции — слово в единственном числе', async () => {
    const { d } = db({
      items: [{ direction: { name: 'Пожарная безопасность' } }, { direction: null }],
    });
    await notifySubmitterEnrollmentStatus(d, req());
    expect(recordNotification.mock.calls[0][1].body).toContain(
      'направление «Пожарная безопасность»'
    );
  });

  it('legacy-заявка без позиций: имя направления из legacyCourseTitle', async () => {
    const { d } = db({ items: [], legacyCourseTitle: 'Старый курс' });
    await notifySubmitterEnrollmentStatus(d, req());
    expect(recordNotification.mock.calls[0][1].body).toContain('направление «Старый курс»');
  });

  it('неизвестная роль подателя: без url и в meta, и в доставке', async () => {
    const { d } = db();
    await notifySubmitterEnrollmentStatus(d, req({ submitterRole: 'student' }));
    expect(recordNotification.mock.calls[0][1].meta).toEqual({
      requestId: 'E1',
      status: 'approved',
    });
    expect(deliverNotificationToUser.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('best-effort: сбой recordNotification проглатывается с log.warn, доставки нет', async () => {
    recordNotification.mockRejectedValue(new Error('db down'));
    const { d } = db();
    await expect(notifySubmitterEnrollmentStatus(d, req())).resolves.toBeUndefined();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] status notify failed', {
      requestId: 'E1',
      error: 'db down',
    });
  });

  it('best-effort: отказ не-Error значением логируется текстом, а не undefined', async () => {
    recordNotification.mockRejectedValue('соединение закрыто');
    const { d } = db();
    await expect(notifySubmitterEnrollmentStatus(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] status notify failed', {
      requestId: 'E1',
      error: 'соединение закрыто',
    });
  });
});

describe('notifyManagersEnrollmentSubmitted (enrollment_submitted менеджерам организации)', () => {
  it('заявка без организации: fan-out пропускается целиком', async () => {
    const { d, findUnique } = db();
    await notifyManagersEnrollmentSubmitted(d, req({ organizationId: null }));
    expect(resolveOrgManagerRecipients).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordNotification).not.toHaveBeenCalled();
  });

  it('нет получателей → ничего не создаётся', async () => {
    const { d, findUnique } = db();
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(resolveOrgManagerRecipients).toHaveBeenCalledWith(d, 'o1', { excludeUserId: 'u1' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordNotification).not.toHaveBeenCalled();
  });

  it('2 получателя: по паре recordNotification+доставка на каждого, dedupKey = id строки', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    recordNotification
      .mockResolvedValueOnce({ row: { id: 'n1' }, deduped: false })
      .mockResolvedValueOnce({ row: { id: 'n2' }, deduped: false });
    const { d } = db();
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(recordNotification).toHaveBeenCalledTimes(2);
    // `У-232`: адреса кабинета в строке нет — ссылку строит таблица маршрутов
    // по `requestId` от роли получателя; ключ дедупа — заявка.
    expect(recordNotification.mock.calls[0][0]).toBe(d);
    expect(recordNotification.mock.calls[0][1]).toMatchObject({
      userId: 'm1',
      organizationId: 'o1',
      type: 'enrollment_submitted',
      title: 'Новая заявка на обучение',
      meta: { requestId: 'E1' },
      entityId: 'E1',
    });
    expect(recordNotification.mock.calls[0][1].meta).not.toHaveProperty('url');
    expect(recordNotification.mock.calls[0][1].body).toBe(
      'Организация «Ромашка»: 5 слушателей, направление «Охрана труда».'
    );
    expect(recordNotification.mock.calls[1][1].userId).toBe('m2');
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser.mock.calls[0][0]).toMatchObject({
      userId: 'm1',
      type: 'enrollment_submitted',
      meta: { requestId: 'E1' },
      dedupKey: 'n1',
    });
    expect(deliverNotificationToUser.mock.calls[0][0]).not.toHaveProperty('url');
    expect(deliverNotificationToUser.mock.calls[1][0]).toMatchObject({
      userId: 'm2',
      dedupKey: 'n2',
    });
  });

  it('повтор за час (deduped: true) — строка «×N», доставка этому получателю не зовётся', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    recordNotification
      .mockResolvedValueOnce({ row: { id: 'n1' }, deduped: true })
      .mockResolvedValueOnce({ row: { id: 'n2' }, deduped: false });
    const { d } = db();
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(recordNotification).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'm2', dedupKey: 'n2' })
    );
  });

  it('организация без имени: body без префикса «Организация …»', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }]);
    const { d } = db({ organization: null });
    await notifyManagersEnrollmentSubmitted(d, req());
    expect(recordNotification.mock.calls[0][1].body).toBe(
      '5 слушателей, направление «Охрана труда».'
    );
  });

  it('best-effort: сбой внутри проглатывается с log.warn', async () => {
    resolveOrgManagerRecipients.mockRejectedValue(new Error('boom'));
    const { d } = db();
    await expect(notifyManagersEnrollmentSubmitted(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] submit notify failed', {
      requestId: 'E1',
      error: 'boom',
    });
  });

  it('best-effort: отказ не-Error значением логируется текстом', async () => {
    resolveOrgManagerRecipients.mockRejectedValue('соединение закрыто');
    const { d } = db();
    await expect(notifyManagersEnrollmentSubmitted(d, req())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] submit notify failed', {
      requestId: 'E1',
      error: 'соединение закрыто',
    });
  });

  it('несколько направлений в заявке — слово склоняется во множественное число', async () => {
    // `У-44`: заявка бывает «много слушателей × много обучений». Менеджер
    // должен прочитать «направления», а не «направление».
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }]);
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
    const { d } = db({
      items: [
        { direction: { name: 'Работы на высоте' } },
        { direction: { name: 'Электробезопасность' } },
      ],
    });

    await notifyManagersEnrollmentSubmitted(d, req());

    expect(recordNotification.mock.calls[0][1].body).toContain(
      'направления «Работы на высоте, Электробезопасность»'
    );
  });

  it('без названия организации письмо начинается со счётчика, а не с «Организация «»»', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }]);
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
    const { d } = db({ organization: null });

    await notifyManagersEnrollmentSubmitted(d, req());

    const body = recordNotification.mock.calls[0][1].body;
    expect(body).not.toContain('Организация');
    expect(body).toContain('5 слушателей');
  });
});
