import { describe, it, expect, vi, beforeEach } from 'vitest';

const { triggerSync, setSchedulePaused, rewindCursor } = vi.hoisted(() => ({
  triggerSync: vi.fn(),
  setSchedulePaused: vi.fn(),
  rewindCursor: vi.fn(),
}));
const { requireAdmin, requireAdminOrManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireAdminOrManagerLeader: vi.fn(),
}));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const { saveSchedulePattern, saveSettings, resetIntegrationSettingsCache, recordAudit } =
  vi.hoisted(() => ({
    saveSchedulePattern: vi.fn(),
    saveSettings: vi.fn(),
    resetIntegrationSettingsCache: vi.fn(),
    recordAudit: vi.fn(),
  }));

vi.mock('@/lib/services/admin/syncControl', () => ({
  triggerSync,
  setSchedulePaused,
  rewindCursor,
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireAdminOrManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/admin/syncSchedules', () => ({ saveSchedulePattern }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ resetIntegrationSettingsCache }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import {
  triggerSyncAction,
  setSchedulePausedAction,
  rewindCursorAction,
  saveSchedulePatternAction,
  saveOneCParamsAction,
} from '@/server-actions/admin/syncControl';

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1' });
  requireAdminOrManagerLeader.mockResolvedValue({ sub: 'admin-1' });
  saveSchedulePattern.mockResolvedValue({ ok: true });
  saveSettings.mockResolvedValue({ ok: true });
});

describe('triggerSyncAction', () => {
  /**
   * `У-118`: ручной запуск открыт и руководителю — при вставшем обмене он
   * должен мочь что-то сделать сам, не дожидаясь администратора. Пауза
   * расписания и перемотка курсора остаются админскими: они платформенные.
   */
  it('пускает и админа, и руководителя; обновляет оба кабинета', async () => {
    triggerSync.mockResolvedValue({ ok: true, jobId: 'manual:order:1' });
    const res = await triggerSyncAction(fd({ entity: 'order' }));
    expect(requireAdminOrManagerLeader).toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(triggerSync).toHaveBeenCalledWith({}, 'admin-1', 'order');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/1c/auto');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/integrations/1c/auto');
    expect(res).toEqual({ ok: true, jobId: 'manual:order:1' });
  });

  it('rejects a missing entity with validation', async () => {
    const res = await triggerSyncAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('passes through service errors', async () => {
    triggerSync.mockResolvedValue({ ok: false, error: 'already_running' });
    expect(await triggerSyncAction(fd({ entity: 'order' }))).toEqual({
      ok: false,
      error: 'already_running',
    });
  });
});

describe('setSchedulePausedAction', () => {
  it('coerces paused and calls the service', async () => {
    setSchedulePaused.mockResolvedValue({ ok: true, paused: true });
    const res = await setSchedulePausedAction(
      fd({ schedulerId: 'oneCSync.pullOrders.cron', paused: 'true' })
    );
    expect(setSchedulePaused).toHaveBeenCalledWith({}, 'admin-1', 'oneCSync.pullOrders.cron', true);
    expect(res).toEqual({ ok: true, paused: true });
  });

  it('returns validation when schedulerId is missing — bare stable code, no zod details (R2)', async () => {
    const res = await setSchedulePausedAction(fd({ paused: 'true' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(setSchedulePaused).not.toHaveBeenCalled();
  });
});

describe('rewindCursorAction', () => {
  it('maps empty cursor string to null', async () => {
    rewindCursor.mockResolvedValue({ ok: true, entity: 'order', cursor: null });
    await rewindCursorAction(fd({ entity: 'order', cursor: '' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', null);
  });

  it('forwards an ISO cursor', async () => {
    rewindCursor.mockResolvedValue({
      ok: true,
      entity: 'order',
      cursor: '2026-06-01T00:00:00.000Z',
    });
    await rewindCursorAction(fd({ entity: 'order', cursor: '2026-06-01T00:00:00.000Z' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', '2026-06-01T00:00:00.000Z');
  });

  it('returns validation when entity is missing — bare stable code, no zod details (R2)', async () => {
    const res = await rewindCursorAction(fd({ cursor: '2026-06-01' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(rewindCursor).not.toHaveBeenCalled();
  });
});

/**
 * Расписание и параметры обмена (`У-125`) — платформенные рычаги, только
 * администратор (`Р-22`).
 *
 * Границы чисел здесь не придирка: таймаут в ноль миллисекунд или
 * отрицательное перекрытие курсора **тихо останавливают обмен**, а человек
 * потом ищет причину в 1С.
 */
describe('saveSchedulePatternAction', () => {
  it('сохранённое расписание освежает вкладку «Автообмен»', async () => {
    const res = await saveSchedulePatternAction('monitoring.slaEscalation.cron', '*/10 * * * *');

    expect(res).toEqual({ ok: true });
    expect(saveSchedulePattern).toHaveBeenCalledWith(
      {},
      'admin-1',
      'monitoring.slaEscalation.cron',
      '*/10 * * * *'
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/1c/auto');
  });

  it('пустая строка — «вернуть умолчание из кода»', async () => {
    await saveSchedulePatternAction('s1', '');

    expect(saveSchedulePattern).toHaveBeenCalledWith({}, 'admin-1', 's1', '');
  });

  it('отказ возвращается как есть и ничего не освежает', async () => {
    saveSchedulePattern.mockResolvedValue({ ok: false, error: 'invalid_cron' });

    const res = await saveSchedulePatternAction('s1', 'ерунда');

    expect(res).toEqual({ ok: false, error: 'invalid_cron' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('saveOneCParamsAction', () => {
  /** Форма параметров: пустые поля означают «взять значение сервера». */
  function params(over: Record<string, string> = {}) {
    return fd({
      onec_mode: '',
      onec_defaultCompanyId: '',
      onec_httpTimeoutMs: '',
      onec_cursorOverlapMinutes: '',
      onec_pendingMaxAttempts: '',
      onec_pendingMaxAgeDays: '',
      ...over,
    });
  }

  it('пустая форма стирает перекрытия, а не пишет пустые строки', async () => {
    const res = await saveOneCParamsAction(params());

    expect(res).toEqual({ ok: true });
    const entries = saveSettings.mock.calls[0]?.[2] as Array<{ key: string; clear?: boolean }>;
    expect(entries.filter((e) => e.clear === true)).toHaveLength(4);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'onec_params_changed', after: { mode: null } })
    );
  });

  it.each(['live', 'shadow', 'LIVE'])('режим «%s» принимается', async (mode) => {
    const res = await saveOneCParamsAction(params({ onec_mode: mode }));

    expect(res).toEqual({ ok: true });
    const entries = saveSettings.mock.calls[0]?.[2] as Array<{ key: string; value?: string }>;
    expect(entries[0]).toEqual({ key: 'onec.mode', value: mode.toLowerCase() });
  });

  it('придуманный режим — отказ до записи', async () => {
    const res = await saveOneCParamsAction(params({ onec_mode: 'боевой-боевой' }));

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('число в границах сохраняется', async () => {
    await saveOneCParamsAction(params({ onec_httpTimeoutMs: '15000' }));

    const entries = saveSettings.mock.calls[0]?.[2] as Array<{ key: string; value?: string }>;
    expect(entries).toContainEqual({ key: 'onec.httpTimeoutMs', value: '15000' });
  });

  it.each([
    ['таймаут ниже предела', { onec_httpTimeoutMs: '999' }],
    ['таймаут выше предела', { onec_httpTimeoutMs: '600001' }],
    ['перекрытие курсора отрицательное', { onec_cursorOverlapMinutes: '-1' }],
    ['попытки докачки — не число', { onec_pendingMaxAttempts: 'много' }],
    ['срок хранения выше предела', { onec_pendingMaxAgeDays: '366' }],
  ])('%s — отказ, в базу ничего не уходит', async (_name, over) => {
    const res = await saveOneCParamsAction(params(over));

    expect(res).toEqual({ ok: false, error: 'value_out_of_range' });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('поле не строка считается пустым', async () => {
    const form = params();
    form.set('onec_httpTimeoutMs', new File(['x'], 'a.txt'));

    await expect(saveOneCParamsAction(form)).resolves.toEqual({ ok: true });
  });

  it('отказ записи не сбрасывает кэш и не пишет журнал', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    const res = await saveOneCParamsAction(params());

    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
