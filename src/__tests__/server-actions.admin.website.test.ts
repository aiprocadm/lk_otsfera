/**
 * Действия раздела настроек «Сайт» (этап 3, `У-211`).
 *
 * Оба действия — дверь в настройки платформы, поэтому первым делом проверяется
 * гард раздела (§4: серверное действие — это HTTP-адрес, скрытая кнопка не
 * защита). Дальше — предел в пять доменов, выпуск токена («показывается один
 * раз») и поведение при сбое сохранения.
 *
 * Разбор списка доменов (`parseAllowedOrigins`) настоящий, без мока: проверяем
 * связку действия и сервиса.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSettingsSection, saveSettings, revalidatePath } = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  saveSettings: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings, getSettingValue: vi.fn() }));
// Проверка менеджера по умолчанию ходит в базу; аудит выпуска токена — тоже.
const { userFindFirst, recordAudit } = vi.hoisted(() => ({
  userFindFirst: vi.fn().mockResolvedValue({ id: 'mgr-1' }),
  recordAudit: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findFirst: userFindFirst } } }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: vi.fn() }));
vi.mock('@/lib/services/clientRequests/notify', () => ({
  notifyManagersClientRequestSubmitted: vi.fn(),
  notifySubmitterClientRequestStatus: vi.fn(),
}));

import { issueSiteTokenAction, saveWebsiteSettingsAction } from '@/server-actions/admin/website';

// ─── helpers ──────────────────────────────────────────────────────────────────

const VALID = {
  enabled: true,
  allowedOrigins: 'https://otsfera.ru',
  defaultManagerId: 'u-mgr-1',
};

/** Что ушло в saveSettings последним вызовом: ключ → значение. */
function savedEntries(): Record<string, string> {
  const entries = saveSettings.mock.calls[saveSettings.mock.calls.length - 1][2];
  return Object.fromEntries(entries.map((e: { key: string; value: string }) => [e.key, e.value]));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue({ sub: 'admin-1', role: 'admin' });
  saveSettings.mockResolvedValue({ ok: true });
});

// ─── гард раздела ─────────────────────────────────────────────────────────────

describe('гард раздела настроек', () => {
  it('сохранение настроек спрашивает права на раздел «Сайт» в кабинете администратора', async () => {
    await saveWebsiteSettingsAction(VALID);

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.website', 'admin');
  });

  it('выпуск токена спрашивает те же права', async () => {
    await issueSiteTokenAction();

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.website', 'admin');
  });

  it('отказ гарда прерывает действие: ничего не сохраняется', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NEXT_REDIRECT /forbidden'));

    await expect(saveWebsiteSettingsAction(VALID)).rejects.toThrow('NEXT_REDIRECT');
    await expect(issueSiteTokenAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('права спрашиваются ДО разбора формы — даже на кривом вводе', async () => {
    // Иначе посторонний по кривому вводу узнаёт, что действие существует и как
    // отвечает, ни разу не столкнувшись с проверкой прав (§4).
    const res = await saveWebsiteSettingsAction({ enabled: 'да' } as never);

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.website', 'admin');
  });
});

// ─── предел доменов ───────────────────────────────────────────────────────────

describe('saveWebsiteSettingsAction — список доменов', () => {
  it('больше пяти доменов: «too_many_origins», настройки НЕ сохраняются', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://s${i}.ru`).join('\n');

    const res = await saveWebsiteSettingsAction({ ...VALID, allowedOrigins: six });

    expect(res).toEqual({ ok: false, error: 'too_many_origins' });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('ровно пять доменов — ещё можно', async () => {
    const five = Array.from({ length: 5 }, (_, i) => `https://s${i}.ru`).join(', ');

    const res = await saveWebsiteSettingsAction({ ...VALID, allowedOrigins: five });

    expect(res).toEqual({ ok: true });
    expect(savedEntries()['site.allowedOrigins'].split('\n')).toHaveLength(5);
  });

  it('домены сохраняются построчно и без хвостовых слэшей', async () => {
    await saveWebsiteSettingsAction({
      ...VALID,
      allowedOrigins: 'https://otsfera.ru/ , https://lk.otsfera.ru//',
    });

    expect(savedEntries()['site.allowedOrigins']).toBe('https://otsfera.ru\nhttps://lk.otsfera.ru');
  });

  it('пустой список доменов сохраняется пустым', async () => {
    await saveWebsiteSettingsAction({ ...VALID, allowedOrigins: '   ' });

    expect(savedEntries()['site.allowedOrigins']).toBe('');
  });
});

// ─── сохранение ───────────────────────────────────────────────────────────────

describe('saveWebsiteSettingsAction — сохранение', () => {
  it('включение и менеджер по умолчанию уходят тремя ключами site.*', async () => {
    const res = await saveWebsiteSettingsAction(VALID);

    expect(res).toEqual({ ok: true });
    expect(savedEntries()).toEqual({
      'site.enabled': 'true',
      'site.allowedOrigins': 'https://otsfera.ru',
      'site.defaultManagerId': 'u-mgr-1',
    });
    expect(saveSettings.mock.calls[0][1]).toBe('admin-1');
  });

  it('выключение приёма пишет строку «false», а не пустоту', async () => {
    await saveWebsiteSettingsAction({ ...VALID, enabled: false });

    expect(savedEntries()['site.enabled']).toBe('false');
  });

  it('токен формы этим действием не трогается — иначе он бы терялся при правке доменов', async () => {
    await saveWebsiteSettingsAction(VALID);

    expect(savedEntries()).not.toHaveProperty('site.formToken');
  });

  it('сбой сохранения: «save_failed», экран не перерисовываем', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    expect(await saveWebsiteSettingsAction(VALID)).toEqual({ ok: false, error: 'save_failed' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('успех перерисовывает страницу раздела', async () => {
    await saveWebsiteSettingsAction(VALID);

    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/website');
  });
});

// ─── выпуск токена ────────────────────────────────────────────────────────────

describe('issueSiteTokenAction — выпуск токена формы', () => {
  it('возвращает открытый токен и сохраняет ровно его', async () => {
    const res = await issueSiteTokenAction();

    expect(res.ok).toBe(true);
    const token = (res as { ok: true; token: string }).token;
    expect(savedEntries()).toEqual({ 'site.formToken': token });
    expect(saveSettings.mock.calls[0][1]).toBe('admin-1');
  });

  it('токен длинный и непредсказуемый: 64 шестнадцатеричных знака', async () => {
    const res = await issueSiteTokenAction();

    expect((res as { token: string }).token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('каждый выпуск даёт новый токен — прежний отзывается', async () => {
    const first = (await issueSiteTokenAction()) as { token: string };
    const second = (await issueSiteTokenAction()) as { token: string };
    const third = (await issueSiteTokenAction()) as { token: string };

    expect(new Set([first.token, second.token, third.token]).size).toBe(3);
  });

  it('сбой сохранения: «save_failed», токен наружу не отдаётся', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    const res = await issueSiteTokenAction();

    expect(res).toEqual({ ok: false, error: 'save_failed' });
    expect(res).not.toHaveProperty('token');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('успех перерисовывает страницу раздела', async () => {
    await issueSiteTokenAction();

    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations/website');
  });

  it('выпуск токена пишет своё событие аудита', async () => {
    // Общей записи «настройки изменены» мало: выпуск ОТЗЫВАЕТ прежний токен и
    // ломает форму на живом сайте, пока её код не обновят, а правка списка
    // доменов — нет. В журнале эти действия должны различаться.
    await issueSiteTokenAction();

    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'site_form_token_issued',
        entity: 'integration_setting',
        entityId: 'site.formToken',
      })
    );
  });
});
