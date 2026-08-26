import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, saveSettings, resetCache, deliverAlert, recordAudit, revalidatePath } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    saveSettings: vi.fn(),
    resetCache: vi.fn(),
    deliverAlert: vi.fn(),
    recordAudit: vi.fn(),
    revalidatePath: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  resetIntegrationSettingsCache: resetCache,
}));
vi.mock('@/lib/monitoring/deliver', () => ({ deliverAlert }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { saveAlertSettingsAction, sendTestAlertAction } from '@/server-actions/admin/alerts';

/**
 * `У-126`: пороги и канал оповещений правятся из интерфейса. Проверяем то, что
 * ломает оповещения молча: значения вне границ, опечатку в адресе и подмену
 * пути тестовой отправки.
 */
function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const FULL = {
  alerts_queueWaitingMax: '150',
  alerts_dlqMax: '2',
  alerts_syncLagMaxHours: '12',
  alerts_renotifyCooldownHours: '3',
  alerts_oneCDeadLetterMax: '5',
  alerts_telegramChatId: '-100500',
  alerts_telegramBotToken: '',
  alerts_emailRecipients: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', role: 'admin' });
  saveSettings.mockResolvedValue({ ok: true });
});

describe('saveAlertSettingsAction (У-126)', () => {
  it('сохраняет пороги и сбрасывает кэш настроек', async () => {
    expect(await saveAlertSettingsAction(fd(FULL))).toEqual({ ok: true });
    const entries = saveSettings.mock.calls[0]![2] as Array<{ key: string; value?: string }>;
    expect(entries).toContainEqual({ key: 'alerts.queueWaitingMax', value: '150' });
    expect(entries).toContainEqual({ key: 'alerts.telegramChatId', value: '-100500' });
    expect(resetCache).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'alert_settings_changed' })
    );
  });

  it('пустой порог — «вернуть значение сервера», а не пустая строка', async () => {
    await saveAlertSettingsAction(fd({ ...FULL, alerts_dlqMax: '' }));
    const entries = saveSettings.mock.calls[0]![2] as Array<{ key: string; clear?: boolean }>;
    expect(entries).toContainEqual({ key: 'alerts.dlqMax', clear: true });
  });

  it.each([
    ['alerts_renotifyCooldownHours', '0', 'ноль часов — письмо каждые пять минут'],
    ['alerts_syncLagMaxHours', '10000', 'порог, который не сработает никогда'],
    ['alerts_queueWaitingMax', 'много', 'не число'],
    ['alerts_queueWaitingMax', '-5', 'отрицательный порог'],
  ])('%s = «%s» отклоняется (%s)', async (field, value) => {
    const res = await saveAlertSettingsAction(fd({ ...FULL, [field]: value }));
    expect(res).toEqual({ ok: false, error: 'value_out_of_range' });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('опечатка в адресе отклоняется — иначе оповещения уходят «в никуда»', async () => {
    const res = await saveAlertSettingsAction(
      fd({ ...FULL, alerts_emailRecipients: 'ops@x.ru, сломанный-адрес' })
    );
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('несколько адресов через запятую и пробел принимаются', async () => {
    const res = await saveAlertSettingsAction(
      fd({ ...FULL, alerts_emailRecipients: 'a@x.ru, b@y.ru;c@z.ru' })
    );
    expect(res).toEqual({ ok: true });
  });

  it('без ключа шифрования отказ доходит до формы как есть', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    expect(await saveAlertSettingsAction(fd(FULL))).toEqual({
      ok: false,
      error: 'secrets_key_missing',
    });
    expect(resetCache).not.toHaveBeenCalled();
  });
});

describe('sendTestAlertAction (У-126)', () => {
  it('идёт тем же путём, что настоящее оповещение, и помечено как проверка', async () => {
    deliverAlert.mockResolvedValue(undefined);
    expect(await sendTestAlertAction()).toEqual({ ok: true });

    const arg = deliverAlert.mock.calls[0]![1] as { kind: string; message: string; type?: string };
    expect(arg.kind).toBe('fire');
    // Дежурный ночью не должен решить, что у него авария.
    expect(arg.message).toContain('не авария');
    expect(arg.type).toBe('ops_alert_test');
  });

  it('сбой доставки возвращается кодом, а не падением', async () => {
    deliverAlert.mockRejectedValue(new Error('telegram down'));
    expect(await sendTestAlertAction()).toEqual({ ok: false, error: 'send_failed' });
  });

  it('только администратор', async () => {
    requireAdmin.mockRejectedValue(new Error('REDIRECT'));
    await expect(sendTestAlertAction()).rejects.toThrow('REDIRECT');
    expect(deliverAlert).not.toHaveBeenCalled();
  });
});
