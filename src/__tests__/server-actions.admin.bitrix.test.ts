/**
 * Действия раздела «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, `У-188`,
 * `У-202`): сохранение подключения и проба. Гард раздела и поведенческий флаг
 * `bitrix_migration` — на каждом действии (§4). Разбор адресов
 * (`portalHost`, `normalizeWebhookUrl`) — настоящий, без мока: проверяем связку.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireSettingsSection,
  notFoundIfDisabled,
  findFirst,
  saveSettings,
  resetIntegrationSettingsCache,
  testIntegration,
  revalidatePath,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  findFirst: vi.fn(),
  saveSettings: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  testIntegration: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findFirst } } }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings, getSettingValues: vi.fn() }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ resetIntegrationSettingsCache }));
vi.mock('@/lib/services/admin/testIntegration', () => ({ testIntegration }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  saveBitrixConnectionAction,
  testBitrixConnectionAction,
} from '@/server-actions/admin/bitrix';

const SESSION = { sub: 'admin-1', role: 'admin' as const, companyId: 'c1' };
const PATH = '/admin/settings/integrations/bitrix';

function fd(data: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(SESSION);
  notFoundIfDisabled.mockReturnValue(null); // флаг включён
  findFirst.mockResolvedValue({ id: 'm1' });
  saveSettings.mockResolvedValue({ ok: true });
});

describe('saveBitrixConnectionAction', () => {
  it('счастливый путь: домен из полного адреса, вебхук нормализован, менеджер проверен в компании; сброс кэша и revalidate', async () => {
    const res = await saveBitrixConnectionAction(
      fd({
        bitrix_portalUrl: ' https://company.bitrix24.ru/crm/ ',
        bitrix_webhookUrl: 'https://company.bitrix24.ru/rest/1/abcDEF123/crm.lead.list',
        bitrix_defaultManagerId: ' m1 ',
      })
    );

    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    // Менеджер ищется только среди активных manager/leader своей компании.
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'm1',
        role: { in: ['manager', 'leader'] },
        isActive: true,
        companyId: 'c1',
      },
      select: { id: true },
    });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: 'company.bitrix24.ru' },
      { key: 'bitrix.webhookUrl', value: 'https://company.bitrix24.ru/rest/1/abcDEF123/' },
      { key: 'bitrix.defaultManagerId', value: 'm1' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('флаг выключен → forbidden, до разбора полей и записи дело не доходит', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_defaultManagerId: 'm1' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    // Гард раздела всё равно отработал первым (страж матрицы настроек).
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('пустые поля: портал и менеджер пустые, вебхук «не менять» — запись трёх пустых значений без похода за менеджером', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: '   ', bitrix_webhookUrl: '  ', bitrix_defaultManagerId: '' })
    );
    expect(res).toEqual({ ok: true });
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: '' },
      { key: 'bitrix.webhookUrl', value: '' }, // пустой секрет = не менять
      { key: 'bitrix.defaultManagerId', value: '' },
    ]);
  });

  it('полей нет в форме вовсе (или это файлы, а не строки) — считается пустым', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_webhookUrl: new Blob(['not-a-string']) })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: '' },
      { key: 'bitrix.webhookUrl', value: '' },
      { key: 'bitrix.defaultManagerId', value: '' },
    ]);
  });

  it('адрес портала без имени хоста → validation с понятным текстом, записи нет', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'https://', bitrix_defaultManagerId: 'm1' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Адрес портала указан неверно.',
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });

  it('портал без схемы принимается как домен', async () => {
    await saveBitrixConnectionAction(fd({ bitrix_portalUrl: 'company.bitrix24.ru' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries[0]).toEqual({ key: 'bitrix.portalUrl', value: 'company.bitrix24.ru' });
  });

  it.each([
    ['не https', 'http://company.bitrix24.ru/rest/1/abc/'],
    ['не адрес', 'просто текст'],
    ['без /rest/<id>/<ключ>/', 'https://company.bitrix24.ru/crm/'],
  ])('вебхук %s → validation с подсказкой формы, записи нет', async (_name, webhook) => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_webhookUrl: webhook })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Вебхук должен иметь вид https://<портал>/rest/<id>/<ключ>/.',
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('менеджер не из компании (не найден) → validation, записи нет', async () => {
    findFirst.mockResolvedValue(null);
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_defaultManagerId: 'stranger' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Менеджер по умолчанию не найден в вашей компании.',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'stranger' }) })
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });

  it('у сессии нет компании — менеджера ищем по заведомо пустой компании, чтобы чужого не подхватить', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'admin-2', role: 'admin' });
    findFirst.mockResolvedValue(null);
    const res = await saveBitrixConnectionAction(fd({ bitrix_defaultManagerId: 'm1' }));
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: '__none__' }) })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('отказ хранилища (нет ключа шифрования) пробрасывается как есть, без сброса кэша и revalidate', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_webhookUrl: 'https://company.bitrix24.ru/rest/1/abc/' })
    );
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('testBitrixConnectionAction', () => {
  it('гард → флаг → универсальная проба по ключу bitrix; успех → revalidate и результат как есть', async () => {
    testIntegration.mockResolvedValue({ ok: true, success: true, message: 'Портал отвечает' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: true, success: true, message: 'Портал отвечает' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(testIntegration).toHaveBeenCalledWith(expect.anything(), SESSION, 'bitrix');
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('неуспешная проба (ok, success=false) тоже revalidate-ится — lastError уже записан', async () => {
    testIntegration.mockResolvedValue({ ok: true, success: false, message: 'HTTP 401' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: true, success: false, message: 'HTTP 401' });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('ошибка сервиса (ok=false) возвращается без revalidate', async () => {
    testIntegration.mockResolvedValue({ ok: false, error: 'not_configured' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: false, error: 'not_configured' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, проба не запускается', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(testIntegration).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
